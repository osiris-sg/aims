/**
 * Round W, Part A (ADH only) — audit EVERY linked email: the stored link vs the hard evidence and an independent
 * second pass (the reasoner without the current link). Prints from-domain + subject 60 only.
 *
 *   DATABASE_URL=<prod> TENANCY_MODE= npx ts-node -r tsconfig-paths/register --transpile-only scripts/_email-audit.ts --org=<id> [--json=out.json] [--only=<subject substring>]
 *     [--apply-clear]     move DISAGREE_CLEAR links (files into EMPTY slots only, else link-only + flag)
 *     [--apply-unclear]   send DISAGREE_UNCLEAR rows back to Unprocessed as a question
 *     [--inspect=<subject substring>]  print the record facts behind one row's keys (the Vedanta CI check)
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
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
import { findKeyHits, recordRef } from '../src/ingestion-email/email-match.rules';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, ActionLogModule, PushModule, IngestionEmailModule] })
class M {}
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ORG = arg('org')!;
const APPLY_CLEAR = process.argv.includes('--apply-clear');
const APPLY_UNCLEAR = process.argv.includes('--apply-unclear');
const ONLY = arg('only');
const INSPECT = arg('inspect');
const ACTOR = { id: 'system:round-w-audit', name: 'Email audit (second pass)' };
const s60 = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s.padEnd(n));

async function main() {
  if (!ORG) throw new Error('--org is required');
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const triage = app.get(EmailTriageService);
  const actionLog = app.get(ActionLogService);
  await runAsOrg(ORG, async () => {
    const org = await prisma.organization.findUnique({ where: { id: ORG }, select: { name: true } });
    if (!/^Asia Deal Hub Japan/i.test(org?.name ?? '')) throw new Error(`refusing: ${ORG} is not the ADH org`);
    const rows: any[] = await prisma.emailIngestLog.findMany({ where: { organizationId: ORG, inboxState: 'PROCESSED' }, orderBy: { createdAt: 'asc' } });
    const linked = rows.filter((r) => (r.orderId || r.shipmentId || r.actions?.general) && r.actions?.review?.outcome !== 'IGNORED' && (!ONLY || (r.subject ?? '').includes(ONLY)));
    const records = await triage.matchRecords(ORG);
    console.log(`${org!.name} · Processed: ${rows.length} · linked / general to audit: ${linked.length} · ${APPLY_CLEAR ? 'APPLY clear' : ''}${APPLY_UNCLEAR ? ' APPLY unclear' : ''}${!APPLY_CLEAR && !APPLY_UNCLEAR ? 'DRY RUN' : ''}\n`);
    if (INSPECT) {
      for (const r of rows.filter((x) => (x.subject ?? '').includes(INSPECT))) {
        const ev = await triage.evidence(r);
        const hits = findKeyHits(ev, records, await (triage as any).ciPatterns(ORG));
        console.log(`INSPECT "${s60(r.subject)}" (${r.fromAddress?.replace(/.*@/, '@')}) → targets ${JSON.stringify((r.actions?.targets ?? []).map((t: any) => ({ ...t })))}`);
        for (const h of hits) {
          const rec = records.find((x) => x.orderId === h.orderId && (h.shipmentId ? x.shipmentId === h.shipmentId : true));
          console.log(`  key ${h.kind} ${h.value} in ${h.where.join('/')} → ${rec ? recordRef(rec) : '?'} (B/L ${rec?.bl ?? '-'} · CI ${rec?.ciNo ?? '-'} · PI ${rec?.piNo ?? '-'} · net ${rec?.netMt ?? '-'} · qty ${rec?.qtyMt ?? '-'} · ${rec?.grade ?? '-'})`);
        }
        for (const a of ev.attachments) {
          const nets = [...(a.text ?? '').matchAll(/(\d{1,3}(?:,\d{3})*\.\d{3})\s*(?:MT|MTS|t\b|KGS?)/gi)].map((m) => m[1]).slice(0, 6);
          const bls = [...(a.text ?? '').matchAll(/\b(?:[0-9]{2}[A-Z]{2})?(\d{3}[A-Z]{2}\d{5})\b/g)].map((m) => m[1]);
          console.log(`  attachment ${a.name}: text ${a.text?.length ?? 0} chars · B/L-like ${[...new Set(bls)].join(',') || '-'} · tonnage-like ${nets.join(',') || '-'}`);
        }
        for (const t of r.actions?.targets ?? []) {
          const rec = records.find((x) => x.orderId === t.orderId && (t.shipmentId ? x.shipmentId === t.shipmentId : true));
          console.log(`  target ${rec ? recordRef(rec) : '?'}: B/L ${rec?.bl ?? '-'} · CI ${rec?.ciNo ?? '-'} · PI ${rec?.piNo ?? '-'} · net ${rec?.netMt ?? '-'} · qty ${rec?.qtyMt ?? '-'} · ${rec?.grade ?? '-'} · ${rec?.customerKey ?? '-'} · attachments ${JSON.stringify(t.attachmentIndexes ?? [])}`);
        }
      }
      console.log('');
    }
    console.log(`${pad('subject (60)', 60)} | ${pad('from', 18)} | ${pad('current', 14)} | ${pad('2nd pass', 22)} | ${pad('verdict', 16)} | evidence`);
    const out: any[] = [];
    const tally: Record<string, number> = {};
    for (const r of linked) {
      const res = await triage.secondPass(ORG, r.id, { store: APPLY_CLEAR || APPLY_UNCLEAR });
      tally[res.verdict] = (tally[res.verdict] ?? 0) + 1;
      const how = r.actions?.review?.outcome === 'AUTO' ? `auto · ${r.actions?.autoLabel ?? '-'}` : `${r.actions?.review?.outcome} · ${r.actions?.review?.by ?? '-'}`;
      const ev = [res.hardCurrent.length ? `for current: ${res.hardCurrent.join(', ')}` : null, res.hardSecond.length ? `for 2nd: ${res.hardSecond.join(', ')}` : null, res.evidence].filter(Boolean).join(' · ');
      console.log(`${pad(s60(r.subject), 60)} | ${pad(res.fromDomain, 18)} | ${pad(res.currentRefs.join('+'), 14)} | ${pad(`${res.secondRefs.join('+') || '—'} ${res.secondText}`, 22)} | ${pad(res.verdict, 16)} | ${ev.slice(0, 160)}`);
      const rec: any = { id: r.id, subject: s60(r.subject), from: res.fromDomain, how, ...res, fixed: null as string | null };
      if (res.verdict === 'DISAGREE_CLEAR' && APPLY_CLEAR && res.move?.length) {
        const did = (r.actions?.done ?? []).some((x: any) => x.status === 'done');
        if (did) await triage.undo(ORG, r.id, ACTOR);
        const targets = res.move.map((t) => ({ orderId: t.orderId, shipmentId: t.shipmentId, attachmentIndexes: t.attachmentIndexes }));
        const planned = await triage.assign(ORG, r.id, { targets }, ACTOR);
        const free = await triage.slotsFree(ORG, (planned as any).planned ?? []);
        if (free) {
          await triage.assign(ORG, r.id, { targets, accept: true }, ACTOR);
          rec.fixed = `moved → ${res.secondRefs.join('+')} (files filed)`;
        } else {
          await triage.assign(ORG, r.id, { targets: targets.map((t) => ({ ...t, attachmentIndexes: [] })), accept: true }, ACTOR);
          rec.fixed = `moved → ${res.secondRefs.join('+')} LINK ONLY — a slot there is already taken, files NOT moved (flag)`;
        }
        actionLog.system('email-audit', 'UPDATE', 'EmailIngestLog', { organizationId: ORG, resourceId: r.id, details: { from: res.currentRefs, to: res.secondRefs, fixed: rec.fixed, subject: s60(r.subject) } });
        console.log(`    ✓ ${rec.fixed}`);
      } else if (res.verdict === 'DISAGREE_UNCLEAR' && APPLY_UNCLEAR) {
        await triage.sendBackAsQuestion(ORG, r.id, res, ACTOR, 'audit');
        rec.fixed = 'back to Unprocessed as a question';
        console.log(`    ↩ ${rec.fixed}`);
      }
      out.push(rec);
    }
    const unprocessed = await prisma.emailIngestLog.count({ where: { organizationId: ORG, inboxState: { in: ['SUGGESTED', 'UNMATCHED', 'UNSURE'] } } });
    console.log(`\nverdicts: ${JSON.stringify(tally)} · Unprocessed now: ${unprocessed}`);
    if (arg('json')) writeFileSync(arg('json')!, JSON.stringify(out, null, 2));
  });
  await app.close();
}
main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(), 200));
