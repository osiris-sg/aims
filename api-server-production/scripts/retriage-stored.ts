/**
 * Backfill: run the email triage on stored emails that never got a verdict
 * (mail stored while the org's intake was STORE-only, before triage was on).
 * Uses the exact service behind POST /email-inbox/:id/retriage — the same AI
 * call, known-sender rules, matching and plan; in TRIAGE mode nothing is
 * attached until someone presses Accept in Shipments › Inbox. NOT_SHIPMENT
 * mail is purged by that service (raw + attachments deleted, a hashed
 * Message-ID kept), exactly as for live mail.
 *
 * ADH only (refuses any other org). Oldest first, one email every 2 s.
 * Idempotent: rows that already have a verdict are skipped. Prints only the
 * from-domain and the first 60 characters of the subject — never bodies or
 * full addresses (email content is untrusted data).
 *
 *   TENANCY_MODE=per-org npx ts-node -r tsconfig-paths/register --transpile-only scripts/retriage-stored.ts --org=<id> [--dry-run] [--limit=N]
 *   (prod: DATABASE_URL=<prod> TENANCY_MODE= …)
 */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { PushModule } from '../src/push/push.module';
import { IngestionEmailModule } from '../src/ingestion-email/ingestion-email.module';
import { EmailTriageService } from '../src/ingestion-email/email-triage.service';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ActionLogModule, PushModule, IngestionEmailModule] })
class RetriageModule {}

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ORG = arg('org');
const DRY = process.argv.includes('--dry-run');
const LIMIT = arg('limit') ? Math.max(1, Number(arg('limit'))) : Infinity;
const ADH = /^Asia Deal Hub Japan/i;
const PAUSE_MS = 2000;

/** "Name <a.b@mitsui-soko.co.jp>" → "mitsui-soko.co.jp" (never the full address). */
export const domainOf = (from: string | null | undefined) => (/@([^>\s]+)/.exec(from ?? '')?.[1] ?? '?').toLowerCase().replace(/[>;,]+$/, '');
/** The first 60 characters of the subject, one line. */
export const subject60 = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!ORG || !/^[0-9a-f-]{36}$/i.test(ORG)) throw new Error('--org=<organization id> is required');
  const app = await NestFactory.createApplicationContext(RetriageModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const triage = app.get(EmailTriageService);
  const org = await prisma.organization.findUnique({ where: { id: ORG }, select: { name: true } });
  if (!org || !ADH.test(org.name)) throw new Error(`refusing: ${ORG} is not the ADH org (${org?.name ?? 'not found'})`);
  console.log(`org: ${org.name} · mode: ${DRY ? 'DRY RUN' : 'RUN'}${Number.isFinite(LIMIT) ? ` · limit ${LIMIT}` : ''}`);

  const counts: Record<string, number> = {};
  const shipmentRows: string[] = [];
  let purged = 0;
  let skipped = 0;
  let failed = 0;
  await runAsOrg(ORG, async () => {
    const rows: Array<{ id: string; fromAddress: string; subject: string | null; createdAt: Date; rawMeta: unknown; status: string; reason: string | null }> = await prisma.emailIngestLog.findMany({
      where: { organizationId: ORG, verdict: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, fromAddress: true, subject: true, createdAt: true, rawMeta: true, status: true, reason: true },
    });
    const todo = rows.filter((r) => (r.rawMeta as { emlKey?: string } | null)?.emlKey);
    skipped = rows.length - todo.length;
    console.log(`${rows.length} row(s) without a verdict · ${todo.length} stored (eml kept) · ${skipped} without a stored email (skipped)\n`);
    for (const [i, r] of todo.slice(0, LIMIT).entries()) {
      const label = `${String(i + 1).padStart(3)}. ${r.createdAt.toISOString().slice(0, 16).replace('T', ' ')}  ${domainOf(r.fromAddress).padEnd(26)} ${subject60(r.subject)}`;
      if (DRY) {
        console.log(label);
        continue;
      }
      try {
        // Same guard as the endpoint: never re-triage an email whose plan already did something.
        const before = await triage.row(ORG, r.id);
        if (before.canUndo || before.verdict) {
          console.log(`${label}\n       skipped (already ${before.verdict ?? 'acted on'})`);
          continue;
        }
        const out = await triage.triage(ORG, r.id);
        counts[out.verdict] = (counts[out.verdict] ?? 0) + 1;
        if (out.inboxState === 'PURGED') purged++;
        let detail = `${out.verdict} → ${out.inboxState}`;
        if (out.verdict === 'SHIPMENT') {
          const row = await triage.row(ORG, r.id);
          const docs = [...new Set(row.attachments.map((a: { docType: string | null }) => a.docType).filter(Boolean))].join(', ') || '—';
          const plan = (row.planned as Array<{ kind: string; docType?: string; field?: string; stepCode?: string; ownerKind?: string }>)
            .map((p) => (p.kind === 'file' ? `${p.docType}→${p.ownerKind ?? '?'}` : p.kind === 'field' ? `field ${p.field ?? ''}` : `subtask ${p.stepCode ?? ''}`))
            .join('; ');
          detail += ` · ${row.matched ?? 'Unmatched'} · docs: ${docs}${plan ? ` · plan: ${plan}` : ''}${row.knownRule ? ` · rule ${row.knownRule}` : ''}`;
          shipmentRows.push(`${domainOf(r.fromAddress)} | ${subject60(r.subject)} | ${row.matched ?? 'Unmatched'} | ${docs}${plan ? ` | ${plan}` : ''}`);
        }
        console.log(`${label}\n       ${detail}`);
      } catch (e) {
        failed++;
        console.log(`${label}\n       FAILED: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
      }
      await sleep(PAUSE_MS);
    }
  });
  if (!DRY) {
    console.log(`\nverdicts: ${JSON.stringify(counts)} · purged (raw + attachments deleted): ${purged} · failed: ${failed}`);
    if (shipmentRows.length) console.log(`\nSHIPMENT rows:\n${shipmentRows.join('\n')}`);
  }
  await app.close();
}

main()
  .catch((e) => {
    console.error(`❌ ${e?.message || e}`);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 200));
