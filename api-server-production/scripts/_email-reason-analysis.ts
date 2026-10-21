/**
 * Round T, Part 1 — READ-ONLY analysis of every ADH email that ever got "Pick shipment (several)" or
 * "Check — subject disagrees": where its cues came from (subject / own text / quoted history / attachments),
 * what the thread knew, and what the right answer turned out to be. Prints from-domain + subject 60 only.
 *
 *   DATABASE_URL=<prod> TENANCY_MODE= npx ts-node -r tsconfig-paths/register --transpile-only scripts/_email-reason-analysis.ts --org=<id> [--json=<file>]
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { PushModule } from '../src/push/push.module';
import { ClerkModule } from '../src/clerk/clerk.module';
import { IngestionEmailModule } from '../src/ingestion-email/ingestion-email.module';
import { EmailTriageService } from '../src/ingestion-email/email-triage.service';
import { cueConflicts, findKeyHits, MatchRecord, recordRef, subjectCues } from '../src/ingestion-email/email-match.rules';
import { splitQuoted } from '../src/ingestion-email/email-quote';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, ActionLogModule, PushModule, IngestionEmailModule] })
class M {}
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ORG = arg('org')!;
const JSON_OUT = arg('json');
const domainOf = (from: string | null | undefined) => (/@([^>\s]+)/.exec(from ?? '')?.[1] ?? '?').toLowerCase().replace(/[>;,]+$/, '');
const subject60 = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
const PICK_RE = /several (orders|shipments|products)|pick the shipment|keys of \d+ (orders|shipments)/i;
const CHECK_RE = /subject disagrees|≠/;

async function main() {
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const triage = app.get(EmailTriageService);
  await runAsOrg(ORG, async () => {
    const rows: any[] = await prisma.emailIngestLog.findMany({ where: { organizationId: ORG, inboxState: { in: ['SUGGESTED', 'UNMATCHED', 'UNSURE', 'PROCESSED', 'HIDDEN'] } }, orderBy: { createdAt: 'asc' } });
    const records: MatchRecord[] = await triage.matchRecords(ORG);
    const refOf = (orderId: string | null, shipmentId: string | null) => {
      const r = records.find((x) => x.orderId === orderId && (!shipmentId || x.shipmentId === shipmentId));
      return r ? recordRef(r) : orderId ? '#?' : '—';
    };
    const recOf = (orderId: string | null, shipmentId: string | null) => records.find((x) => x.orderId === orderId && (!shipmentId || x.shipmentId === shipmentId)) ?? null;
    const picked = rows.filter((r) => {
      const a = r.actions ?? {};
      const texts = [...(a.check ?? []), ...(a.blocked ?? []), a.backlog?.reason ?? '', a.reason?.label ?? '', typeof a.reason === 'string' ? a.reason : ''].join(' | ');
      return PICK_RE.test(texts) || CHECK_RE.test(texts);
    });
    console.log(`ADH emails: ${rows.length} · ever "pick (several)" or "subject disagrees": ${picked.length}\n`);
    const out: any[] = [];
    const counts: Record<string, number> = {};
    const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
    for (const r of picked) {
      const a = r.actions ?? {};
      const ev = await triage.evidence(r);
      const { own, quoted } = splitQuoted(ev.body);
      const hits = findKeyHits(ev, records);
      const where = (w: string) => [...new Set(hits.filter((h) => h.where.includes(w as any)).map((h) => `${h.kind.toUpperCase()} ${h.value}→${refOf(h.orderId, h.shipmentId)}`))];
      const sub = subjectCues(r.subject, ev.date);
      const ownCues = subjectCues(own.slice(0, 2000), ev.date);
      const thread: any = await (triage as any).threadContext(ORG, r, records);
      const review = a.review?.outcome ?? null;
      const truthTargets: any[] = review && review !== 'REJECTED' && review !== 'IGNORED' ? (a.targets?.length ? a.targets : r.orderId ? [{ orderId: r.orderId, shipmentId: r.shipmentId }] : []) : [];
      const truth = truthTargets.map((t) => refOf(t.orderId, t.shipmentId ?? null));
      const truthRec = truthTargets[0] ? recOf(truthTargets[0].orderId, truthTargets[0].shipmentId ?? null) : null;
      const reasonSeen = [...(a.check ?? []), ...(a.blocked ?? []).filter((b: string) => /^(a|c):/.test(b)), a.backlog?.reason ?? ''].filter(Boolean).join(' | ').slice(0, 140);
      const kind = PICK_RE.test(reasonSeen) && !CHECK_RE.test(reasonSeen) ? 'PICK' : CHECK_RE.test(reasonSeen) ? 'CHECK' : 'PICK';
      const causes: string[] = [];
      const ownStrong = where('body').length + where('attachment').length;
      if (sub.multi && (ownStrong || ownCues.grades.length === 1)) causes.push('multi-product subject reused (own text / attachment names one)');
      else if (sub.multi) causes.push('multi-product subject, nothing in own text / attachments');
      if (truthRec && sub.months.length && truthRec.deliveryMonth && !sub.months.includes(truthRec.deliveryMonth)) causes.push('stale month in subject');
      const quotedOther = hits.filter((h) => h.where.length === 1 && h.where[0] === 'quoted' && truthRec && h.orderId !== truthRec.orderId);
      if (quotedOther.length) causes.push("quoted history carries other orders' keys");
      if (truthRec) {
        const conf = cueConflicts(sub, truthRec);
        for (const c of conf) causes.push(`false subject conflict on the true record: ${c.split(' ')[0]}`);
      }
      if (!truthRec && thread.candidates.length > 1 && !ownStrong && !ownCues.grades.length) causes.push('combined thread, no cue anywhere (genuine pick)');
      if (!causes.length) causes.push(truthRec ? 'other' : 'no truth yet');
      for (const c of causes) bump(`${kind}: ${c}`);
      const row = { kind, state: r.inboxState, from: domainOf(r.fromAddress), subject: subject60(r.subject), reasonSeen, subjectCues: { multi: sub.multi, grades: sub.grades, qtys: sub.qtys, months: sub.months }, ownTextCues: { grades: ownCues.grades, qtys: ownCues.qtys }, keys: { subject: where('subject'), own: where('body'), quoted: where('quoted'), attachment: where('attachment') }, thread: { accepted: thread.accepted ? refOf(thread.accepted.orderId, thread.accepted.shipmentId) : null, candidates: thread.candidates.map((c: any) => refOf(c.orderId, c.shipmentId)) }, suggested: a.suggested ? refOf(a.suggested.orderId, a.suggested.shipmentId ?? null) : null, review, truth, causes };
      out.push(row);
      console.log(`${kind.padEnd(5)} ${r.inboxState.padEnd(10)} ${row.from.padEnd(18)} | ${row.subject.padEnd(60)}\n      seen: ${reasonSeen}\n      subject: multi=${sub.multi} grades=${sub.grades.join('/')} qty=${sub.qtys.join('/')} month=${sub.months.join('/')} · own: grades=${ownCues.grades.join('/')} qty=${ownCues.qtys.join('/')}\n      keys: subject=[${row.keys.subject.join(', ')}] own=[${row.keys.own.join(', ')}] quoted=[${row.keys.quoted.join(', ')}] att=[${row.keys.attachment.join(', ')}]\n      thread: accepted=${row.thread.accepted} covers=${row.thread.candidates.join('/')} · suggested=${row.suggested} · review=${review} truth=${truth.join('/') || '—'}\n      causes: ${causes.join('; ')}`);
    }
    // ── after: today's rules over EVERY email — did the two reasons go away, did any decision flip against the truth?
    if (process.argv.includes('--after')) {
      console.log('\n── RE-RUN (dry, no writes): today\'s rules over every stored email ──');
      const tally: Record<string, number> = {};
      const t = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);
      const flips: string[] = [];
      for (const r of rows) {
        if (r.inboxState === 'HIDDEN') continue;
        const a = r.actions ?? {};
        const ev = await triage.evidence(r);
        const d = await triage.decide(ORG, r, ev);
        const newRef = d.target ? refOf(d.target.orderId, d.target.shipmentId) : null;
        const review = a.review?.outcome ?? null;
        const truthTargets: any[] = review && review !== 'REJECTED' && review !== 'IGNORED' ? (a.targets?.length ? a.targets : r.orderId ? [{ orderId: r.orderId, shipmentId: r.shipmentId }] : []) : [];
        const truth = truthTargets.map((x) => refOf(x.orderId, x.shipmentId ?? null));
        const oldTexts = [...(a.check ?? []), ...(a.blocked ?? []), a.backlog?.reason ?? ''].join(' | ');
        const wasPick = PICK_RE.test(oldTexts);
        const wasCheck = CHECK_RE.test(oldTexts) || (a.check?.length ?? 0) > 0;
        const nowCheck = d.check.length > 0;
        const nowPick = !d.target && (d.multiOrderIds.length > 1 || /pick the shipment/.test(d.reason ?? ''));
        if (wasPick) t(nowPick ? 'pick → still pick' : d.target ? `pick → decided (${d.source ?? d.kind})` : 'pick → no match');
        if (wasCheck) t(nowCheck ? 'check → still check' : 'check → no check');
        if (truth.length) {
          if (!newRef) t('truth known: no decision now');
          else if (truth.includes(newRef) || (truth.length > 1 && truth.some((x) => x.split('-')[0] === newRef!.split('-')[0]))) t('truth known: agrees');
          else {
            t('truth known: DISAGREES');
            flips.push(`${domainOf(r.fromAddress).padEnd(18)} | ${subject60(r.subject).padEnd(60)} | now ${newRef} (${d.source ?? d.kind}) vs truth ${truth.join('/')} · ${d.reason}`);
          }
        }
        if (wasPick || wasCheck) console.log(`  ${(wasPick ? 'PICK ' : '') + (wasCheck ? 'CHECK' : '')}`.padEnd(12) + `${domainOf(r.fromAddress).padEnd(18)} | ${subject60(r.subject).padEnd(60)} → ${newRef ?? '—'} ${d.source ? `(${d.source})` : ''}${nowCheck ? ` CHECK: ${d.check.join('; ')}` : ''}${nowPick ? ' PICK' : ''} · truth ${truth.join('/') || '—'}`);
      }
      console.log('\n── before → after ──');
      for (const [k, v] of Object.entries(tally).sort()) console.log(`${String(v).padStart(3)}  ${k}`);
      if (flips.length) { console.log('\n⚠ decisions that disagree with a known truth:'); for (const f of flips) console.log('  ' + f); } else console.log('\n✔ no decision flips against a known truth');
    }
    console.log('\n── causes (count) ──');
    for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(3)}  ${k}`);
    if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
  });
  await app.close();
}
main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(), 200));
