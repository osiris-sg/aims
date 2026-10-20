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
 * --rematch re-runs only the MATCHING (no AI call) on SHIPMENT emails left Unmatched — e.g. after
 * orders were imported — and says why the rest still don't match.
 *
 * --verdict=UNSURE re-runs the triage on emails left UNSURE (still stored, nothing
 * done from them yet) — e.g. after the intake rules change.
 *
 *   TENANCY_MODE=per-org npx ts-node -r tsconfig-paths/register --transpile-only scripts/retriage-stored.ts --org=<id> [--dry-run] [--limit=N] [--verdict=UNSURE]
 *   (prod: DATABASE_URL=<prod> TENANCY_MODE= …)
 */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { ActionLogService } from '../src/action-log/action-log.service';
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
const REDO = arg('verdict');
const REMATCH = process.argv.includes('--rematch');
if (REDO && REDO !== 'UNSURE') throw new Error('--verdict takes UNSURE only');
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

  if (REMATCH) {
    await runAsOrg(ORG, () => rematch(prisma, triage, app.get(ActionLogService)));
    await app.close();
    return;
  }
  const counts: Record<string, number> = {};
  const shipmentRows: string[] = [];
  let purged = 0;
  let skipped = 0;
  let failed = 0;
  await runAsOrg(ORG, async () => {
    const rows: Array<{ id: string; fromAddress: string; subject: string | null; createdAt: Date; rawMeta: unknown; status: string; reason: string | null }> = await prisma.emailIngestLog.findMany({
      where: REDO ? { organizationId: ORG, verdict: 'UNSURE', inboxState: 'UNSURE' } : { organizationId: ORG, verdict: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, fromAddress: true, subject: true, createdAt: true, rawMeta: true, status: true, reason: true },
    });
    const todo = rows.filter((r) => (r.rawMeta as { emlKey?: string } | null)?.emlKey);
    skipped = rows.length - todo.length;
    console.log(`${rows.length} row(s) ${REDO ? 'left UNSURE' : 'without a verdict'} · ${todo.length} stored (eml kept) · ${skipped} without a stored email (skipped)\n`);
    for (const [i, r] of todo.slice(0, LIMIT).entries()) {
      const label = `${String(i + 1).padStart(3)}. ${r.createdAt.toISOString().slice(0, 16).replace('T', ' ')}  ${domainOf(r.fromAddress).padEnd(26)} ${subject60(r.subject)}`;
      if (DRY) {
        console.log(label);
        continue;
      }
      try {
        // Same guard as the endpoint: never re-triage an email whose plan already did something.
        const before = await triage.row(ORG, r.id);
        if (before.canUndo || (before.verdict && before.verdict !== REDO)) {
          console.log(`${label}\n       skipped (already ${before.verdict ?? 'acted on'})`);
          continue;
        }
        const out = await triage.triage(ORG, r.id);
        counts[out.verdict] = (counts[out.verdict] ?? 0) + 1;
        if (out.inboxState === 'PURGED') purged++;
        let detail = `${out.verdict} → ${out.inboxState}`;
        if (out.verdict !== 'SHIPMENT') {
          const t = (await prisma.emailIngestLog.findFirst({ where: { id: r.id }, select: { triage: true } }))?.triage as { keptBy?: string; aiVerdict?: string } | null;
          if (t?.keptBy) detail += ` · kept (${t.keptBy})${t.aiVerdict ? `, AI said ${t.aiVerdict}` : ''}`;
        }
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

/** Matching only, on SHIPMENT emails left Unmatched (TRIAGE mode: a match becomes a suggestion; nothing is attached). */
async function rematch(prisma: PrismaService, triage: EmailTriageService, actionLog: ActionLogService) {
  const cfg = await prisma.emailIngestConfig.findUnique({ where: { organizationId: ORG! }, select: { routingMode: true } });
  const mode = cfg?.routingMode === 'AUTO' ? 'AUTO' : 'TRIAGE';
  const rows: Array<{ id: string; fromAddress: string; subject: string | null; createdAt: Date; triage: any }> = await prisma.emailIngestLog.findMany({
    where: { organizationId: ORG!, verdict: 'SHIPMENT', inboxState: 'UNMATCHED' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, fromAddress: true, subject: true, createdAt: true, triage: true },
  });
  console.log(`${rows.length} Unmatched SHIPMENT email(s) · mode ${mode}${DRY ? ' · DRY RUN (matching is not re-run)' : ''}\n`);
  let matched = 0;
  for (const [i, r] of rows.entries()) {
    const keys = r.triage?.keys ?? {};
    const shown = Object.entries(keys)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    const label = `${String(i + 1).padStart(3)}. ${domainOf(r.fromAddress).padEnd(22)} ${subject60(r.subject)}`;
    if (DRY) {
      console.log(`${label}\n       keys: ${shown || '—'}`);
      continue;
    }
    const state = await triage.matchAndPlan(ORG!, r.id, keys, mode);
    const after = await prisma.emailIngestLog.findFirst({ where: { id: r.id }, select: { actions: true, orderId: true, shipmentId: true } });
    const order = after?.orderId ? await prisma.tradeOrder.findFirst({ where: { id: after.orderId }, select: { orderNo: true } }) : null;
    const ship = after?.shipmentId ? await prisma.shipment.findFirst({ where: { id: after.shipmentId }, select: { seqNo: true, blNumber: true } }) : null;
    const by = (after?.actions as { matchedBy?: string } | null)?.matchedBy ?? null;
    actionLog.system('email-rematch', 'TRIAGE', 'EmailIngestLog', { organizationId: ORG!, resourceId: r.id, details: { inboxState: state, matchedBy: by } });
    if (state !== 'UNMATCHED') {
      matched++;
      const ref = ship ? `#${order?.orderNo ?? '?'}-${ship.seqNo} (B/L ${ship.blNumber})` : order ? `#${order.orderNo}` : '?';
      console.log(`${label}\n       → ${state} · ${ref} · by ${by}`);
    } else {
      console.log(`${label}\n       still Unmatched · ${await whyUnmatched(prisma, keys, order?.orderNo ?? null)}`);
    }
  }
  if (!DRY) console.log(`\nmatched ${matched} of ${rows.length} · still Unmatched ${rows.length - matched}`);
}

/** Why an email's keys find no single record. */
async function whyUnmatched(prisma: PrismaService, k: Record<string, string | null>, orderNo: number | null): Promise<string> {
  const out: string[] = [];
  if (orderNo) out.push(`matched order #${orderNo} but it has several shipments (pick the shipment)`);
  if (k.blNo) out.push(`B/L ${k.blNo}: ${(await prisma.shipment.count({ where: { organizationId: ORG!, blNumber: k.blNo } })) ? 'found' : 'not in AIMS'}`);
  if (k.piNo) out.push(`PI ${k.piNo}: ${(await prisma.tradeOrder.count({ where: { organizationId: ORG!, OR: [{ piNo: k.piNo }, { supplierOrder: { piNo: k.piNo } }] } })) ? 'found' : 'not in AIMS'}`);
  if (k.ciNo) out.push(`CI ${k.ciNo}: not on a shipment`);
  if (k.contractNo) {
    const n = await prisma.tradeOrder.count({ where: { organizationId: ORG!, status: 'OPEN', contract: { contractNo: k.contractNo } } });
    out.push(`contract ${k.contractNo}: ${n} open orders${n > 1 ? ' (ambiguous)' : ''}`);
  }
  if (k.orderRef) out.push(`order ref "${k.orderRef}" (not used for matching)`);
  return out.join(' · ') || 'no B/L, PI, CI or contract number in the email';
}

main()
  .catch((e) => {
    console.error(`❌ ${e?.message || e}`);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 200));
