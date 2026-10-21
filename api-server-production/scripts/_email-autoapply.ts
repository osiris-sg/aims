/**
 * Round U, Part 1 (ADH only; the owner OK'd the prod apply): apply the sure decisions on the Unprocessed backlog.
 *   HIGH    a hard key in an attachment / the own text, no subject conflict, no other order's key
 *   MEDIUM  a thread / cue decision that points where the thread's most recent accepted message points
 * Each applied email: re-matched with today's rules (saved), then executed as "Auto · reviewed · <key>" — files into
 * EMPTY slots only (AUTO-GATE: single-slot types never replaced), evidence note saved, Undo kept. Everything else is
 * left with its exact reason. Prints from-domain + subject 60 only.
 *
 *   DATABASE_URL=<prod> TENANCY_MODE= npx ts-node -r tsconfig-paths/register --transpile-only scripts/_email-autoapply.ts --org=<id> [--apply]
 */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { ActionLogService } from '../src/action-log/action-log.service';
import { PushModule } from '../src/push/push.module';
import { ClerkModule } from '../src/clerk/clerk.module';
import { IngestionEmailModule } from '../src/ingestion-email/ingestion-email.module';
import { EmailTriageService } from '../src/ingestion-email/email-triage.service';
import { autoTier, MatchRecord, recordRef } from '../src/ingestion-email/email-match.rules';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, ActionLogModule, PushModule, IngestionEmailModule] })
class M {}
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ORG = arg('org')!;
const APPLY = process.argv.includes('--apply');
const ACTOR = { id: 'system:round-u-review', name: 'Email intake (reviewed)' };
const domainOf = (from: string | null | undefined) => (/@([^>\s]+)/.exec(from ?? '')?.[1] ?? '?').toLowerCase().replace(/[>;,]+$/, '');
const subject60 = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);

async function main() {
  if (!ORG) throw new Error('--org is required');
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const triage = app.get(EmailTriageService);
  const actionLog = app.get(ActionLogService);
  await runAsOrg(ORG, async () => {
    const org = await prisma.organization.findUnique({ where: { id: ORG }, select: { name: true } });
    if (!/^Asia Deal Hub Japan/i.test(org?.name ?? '')) throw new Error(`refusing: ${ORG} is not the ADH org`);
    const rows: any[] = await prisma.emailIngestLog.findMany({ where: { organizationId: ORG, inboxState: { in: ['SUGGESTED', 'UNMATCHED', 'UNSURE'] } }, orderBy: { createdAt: 'asc' } });
    const records: MatchRecord[] = await triage.matchRecords(ORG);
    const refOf = (orderId: string | null, shipmentId: string | null) => {
      const r = records.find((x) => x.orderId === orderId && (!shipmentId || x.shipmentId === shipmentId));
      return r ? (shipmentId ? recordRef(r) : `#${r.orderNo}`) : '—';
    };
    console.log(`${org!.name} · Unprocessed before: ${rows.length} · ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
    console.log(`${'subject (60)'.padEnd(60)} | ${'decision'.padEnd(8)} | ${'source'.padEnd(12)} | tier   | result`);
    let applied = 0;
    const left: Record<string, number> = {};
    for (const r of rows) {
      const ev = await triage.evidence(r);
      const d = await triage.decide(ORG, r, ev);
      const thread: any = await (triage as any).threadContext(ORG, r, records);
      const tier = autoTier(d, thread);
      const ref = d.target ? refOf(d.target.orderId, d.target.shipmentId) : '—';
      const srcLabel = d.source === 'attachment' ? 'attachment' : d.source === 'own' ? 'own text' : d.source === 'thread' ? 'thread' : d.source === 'subject' ? 'subject key' : d.source === 'subject-cues' ? 'subject cues' : d.source === 'own-cues' ? 'own cues' : '—';
      const label = `${subject60(r.subject).padEnd(60)} | ${ref.padEnd(8)} | ${srcLabel.padEnd(12)} | ${(tier ?? '—').padEnd(6)} |`;
      const reason = d.check.length ? `check — ${d.check.join('; ')}` : !d.target ? (d.multiOrderIds.length > 1 || /pick the shipment/.test(d.reason ?? '') ? 'pick (combined thread, no cue)' : r.actions?.backlog?.kind === 'NO_ORDER' ? 'no order yet' : (d.reason ?? 'no match')) : tier ? null : `medium but ${thread.accepted ? 'disagrees with the thread' : 'no accepted message in the thread'}`;
      if (!tier || reason) {
        const k = reason ?? 'left';
        left[k.split(' — ')[0].split(' (')[0]] = (left[k.split(' — ')[0].split(' (')[0]] ?? 0) + 1;
        console.log(`${label} left · ${k}`);
        continue;
      }
      // Re-match with today's rules (saved, never auto by that path), then gate the slots and apply.
      const re = await triage.rematchStored(ORG, r.id, APPLY);
      const gateOk = await triage.slotsFree(ORG, re.plan);
      const unsupported = re.plan.filter((a: any) => a.kind === 'file' && a.status === 'planned' && a.stepOk === false);
      if (!gateOk || unsupported.length) {
        left['AUTO-GATE (slot taken / no step)'] = (left['AUTO-GATE (slot taken / no step)'] ?? 0) + 1;
        console.log(`${label} left · AUTO-GATE: ${!gateOk ? 'a slot already holds that document type' : `no step takes ${unsupported.map((a: any) => a.docType).join(', ')}`}`);
        continue;
      }
      const files = re.plan.filter((a: any) => a.kind === 'file' && a.status === 'planned').length;
      if (APPLY) {
        const after = await prisma.emailIngestLog.findFirst({ where: { id: r.id }, select: { actions: true } });
        await prisma.emailIngestLog.update({ where: { id: r.id }, data: { actions: { ...((after?.actions as object) ?? {}), evidence: d.reason, autoTier: tier } as any } });
        await triage.execute(ORG, r.id, ACTOR, { review: 'AUTO', autoLabel: `reviewed · ${d.keyLabel ?? (d.source === 'thread' ? 'thread' : 'subject')}` });
        actionLog.system('email-autoapply', 'PROCESS', 'EmailIngestLog', { organizationId: ORG, resourceId: r.id, details: { tier, target: ref, source: d.source, files, from: domainOf(r.fromAddress), subject: subject60(r.subject) } });
      }
      applied++;
      console.log(`${label} ${APPLY ? '✓ applied' : 'would apply'} → ${ref}${files ? ` · ${files} file${files > 1 ? 's' : ''}` : ' · link only'} · ${(d.reason ?? '').slice(0, 70)}`);
    }
    const after = await prisma.emailIngestLog.count({ where: { organizationId: ORG, inboxState: { in: ['SUGGESTED', 'UNMATCHED', 'UNSURE'] } } });
    console.log(`\n${APPLY ? 'applied' : 'would apply'}: ${applied} · left: ${JSON.stringify(left)} · Unprocessed after: ${APPLY ? after : rows.length - applied}`);
  });
  await app.close();
}
main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(), 200));
