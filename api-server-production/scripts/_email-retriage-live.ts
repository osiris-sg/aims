/**
 * Round R correction, step 2 (ADH only, dry run unless --apply): run the LIVE intake (AI triage → rules →
 * per-attachment keys → thread reasoner → backlog rules, PARTIAL_AUTO guards) on the unprocessed emails that were
 * unhidden — exactly what live mail gets. Prints from-domain + subject 60, before → after.
 */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { PushModule } from '../src/push/push.module';
import { ClerkModule } from '../src/clerk/clerk.module';
import { IngestionEmailModule } from '../src/ingestion-email/ingestion-email.module';
import { EmailTriageService } from '../src/ingestion-email/email-triage.service';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, ActionLogModule, PushModule, IngestionEmailModule] })
class M {}
const ORG = process.argv.find((a) => a.startsWith('--org='))?.slice(6)!;
const APPLY = process.argv.includes('--apply');
const domainOf = (from: string | null | undefined) => (/@([^>\s]+)/.exec(from ?? '')?.[1] ?? '?').toLowerCase().replace(/[>;,]+$/, '');
const subject60 = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
async function main() {
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const triage = app.get(EmailTriageService);
  await runAsOrg(ORG, async () => {
    const rows: any[] = await prisma.emailIngestLog.findMany({ where: { organizationId: ORG, inboxState: { in: ['SUGGESTED', 'UNMATCHED', 'UNSURE'] } }, orderBy: { createdAt: 'asc' } });
    // The rows the correction script un-hid: it stamps rawMeta.autoSubmitted=false (the re-match used to drop
    // actions.unhidden; the service now keeps it — re-stamped below so the classifier never re-hides them).
    const todo = rows.filter((r) => (r.actions?.unhidden === true || r.rawMeta?.autoSubmitted === false) && !(r.actions?.done ?? []).some((a: any) => a.status === 'done'));
    console.log(`${todo.length} unhidden email(s) · ${APPLY ? 'LIVE INTAKE' : 'DRY RUN (listing only)'}\n`);
    const by: Record<string, number> = {};
    for (const r of todo) {
      const before = `${r.inboxState}${r.orderId ? ' ' + ((await triage.row(ORG, r.id)).matched ?? '') : ''}`;
      const label = `${domainOf(r.fromAddress).padEnd(20)} | ${subject60(r.subject).padEnd(60)} | ${before.padEnd(18)}`;
      if (!APPLY) {
        console.log(`· ${label}`);
        continue;
      }
      try {
        if (!r.actions?.unhidden) await prisma.emailIngestLog.update({ where: { id: r.id }, data: { actions: { ...((r.actions as object) ?? {}), unhidden: true } as any } });
        const out = await triage.triage(ORG, r.id);
        const row: any = await triage.row(ORG, r.id);
        const filed = (row.done as any[]).filter((a) => a.kind === 'file' && a.status === 'done').length;
        const what = `${out.inboxState}${row.matched ? ` · ${row.matched}` : ''}${row.autoLabel ? ` · Auto · ${row.autoLabel}` : ''}${filed ? ` · ${filed} filed` : ''}${row.reason?.label ? ` · ${row.reason.label}` : ''}`;
        by[out.inboxState] = (by[out.inboxState] ?? 0) + 1;
        console.log(`✓ ${label} → ${what}${row.evidence ? `\n      evidence: ${String(row.evidence).slice(0, 160)}` : ''}`);
      } catch (e) {
        console.log(`✗ ${label} → FAILED ${String((e as Error)?.message ?? e).slice(0, 120)}`);
      }
    }
    if (APPLY) console.log(`\nafter: ${JSON.stringify(by)}`);
  });
  await app.close();
}
main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(), 200));
