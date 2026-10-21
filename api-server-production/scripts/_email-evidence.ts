/**
 * Round R, Part 2A — evidence dump for the unprocessed inbox rows (read-only). Prints per row: from-domain,
 * subject 60, the OWN text (quoted history stripped, first 500 chars), keys / containers / grade-size cues found
 * in the own text, the quoted text's keys, each attachment (name, triage type, keys, containers, weights, grade
 * cues from its content), the thread's other messages, the current decision and the top candidates. Then the open
 * orders / shipments table. No bank details, no bodies beyond the snippet. ADH only.
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
import { findKeyHits, subjectCues } from '../src/ingestion-email/email-match.rules';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, ActionLogModule, PushModule, IngestionEmailModule] })
class M {}
const ORG = process.argv.find((a) => a.startsWith('--org='))?.slice(6)!;
const domainOf = (from: string | null | undefined) => (/@([^>\s]+)/.exec(from ?? '')?.[1] ?? '?').toLowerCase().replace(/[>;,]+$/, '');
const subject60 = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
const QUOTE = /^(>|On .* wrote:|-{3,}\s*Original Message|-{3,}\s*元のメッセージ|From:|差出人:|送信者:|Sent:|送信日時:|\d{4}年\d{1,2}月\d{1,2}日.*(wrote|書きました)|.*<[^>]+@[^>]+>\s*$)/i;
function splitQuoted(body: string): { own: string; quoted: string } {
  const lines = (body ?? '').split(/\r?\n/);
  const i = lines.findIndex((l) => QUOTE.test(l.trim()));
  if (i < 0) return { own: body, quoted: '' };
  return { own: lines.slice(0, i).join('\n'), quoted: lines.slice(i).join('\n') };
}
const containers = (t: string) => [...new Set((t.match(/\b[A-Z]{4}\d{7}\b/g) ?? []))];
const weights = (t: string) => [...new Set((t.match(/\d{1,3}(?:,\d{3})*\.\d{3}\s*(?:MT|KGS?|kg)/gi) ?? []).slice(0, 6))];
async function main() {
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const triage = app.get(EmailTriageService);
  await runAsOrg(ORG, async () => {
    const records = await triage.matchRecords(ORG);
    console.log('=== OPEN ORDERS / SHIPMENTS ===');
    for (const r of records) console.log([`#${r.orderNo}${r.seqNo ? `-${r.seqNo}` : ''}`, r.orderStatus, r.shipStatus ?? '', r.customerKey, r.grade, r.size, `qty ${r.qtyMt}`, `net ${r.netMt}`, `del ${r.deliveryMonth}`, `bl ${r.bl}`, `pi ${r.piNo}`, `ci ${r.ciNo}`, r.port].join(' | '));
    const ships: any[] = await prisma.shipment.findMany({ where: { organizationId: ORG, status: 'OPEN' }, select: { id: true, blNumber: true, vessel: true, voyageNo: true, eta: true, netWeightMt: true, order: { select: { orderNo: true } }, seqNo: true } });
    console.log('=== VESSELS ===');
    for (const s of ships) console.log(`#${s.order?.orderNo}-${s.seqNo} | bl ${s.blNumber} | ${s.vessel} / ${s.voyageNo} | eta ${s.eta?.toISOString().slice(0, 10)}`);
    const rows: any[] = await prisma.emailIngestLog.findMany({ where: { organizationId: ORG, inboxState: { in: ['SUGGESTED', 'UNMATCHED', 'UNSURE'] } }, orderBy: { createdAt: 'asc' } });
    for (const [i, l] of rows.entries()) {
      const kind = l.actions?.backlog?.kind;
      if (kind === 'NO_ORDER') continue;
      const ev = await triage.evidence(l);
      const { own, quoted } = splitQuoted(ev.body);
      const ownHits = findKeyHits({ subject: ev.subject, body: own, attachments: [], date: ev.date }, records);
      const quotedHits = findKeyHits({ subject: '', body: quoted, attachments: [], date: ev.date }, records);
      const d = await triage.decide(ORG, l, ev);
      console.log(`\n### ${i + 1}. [${l.inboxState}/${kind}] ${domainOf(l.fromAddress)} | ${subject60(l.subject)} | ${l.emailDate?.toISOString().slice(0, 16)} | cp ${l.counterparty} | dir ${l.direction}`);
      console.log(`  own-text keys: ${ownHits.map((h) => `${h.kind} ${h.value}→#${records.find((r) => r.orderId === h.orderId)?.orderNo}${h.shipmentId ? '-' + records.find((r) => r.shipmentId === h.shipmentId)?.seqNo : ''} [${h.where}]`).join(', ') || '—'} | quoted keys: ${quotedHits.map((h) => `${h.kind} ${h.value}→#${records.find((r) => r.orderId === h.orderId)?.orderNo}`).join(', ') || '—'}`);
      console.log(`  own containers: ${containers(own).join(',') || '—'} | cues(subject): ${JSON.stringify(subjectCues(ev.subject, ev.date))} | cues(own): ${JSON.stringify(subjectCues(own.slice(0, 2000), ev.date))}`);
      console.log(`  OWN TEXT: ${own.replace(/\s+/g, ' ').trim().slice(0, 500)}`);
      for (const [ai, a] of ev.attachments.entries()) {
        const t = (l.triage?.attachments ?? []).find((x: any) => x.filename === a.name);
        const hits = findKeyHits({ subject: '', body: '', attachments: [a], date: ev.date }, records);
        console.log(`  ATT[${ai}] ${a.name} | type ${t?.docType ?? '?'} (${t?.confidence ?? '?'}) | keys: ${hits.map((h) => `${h.kind} ${h.value}→#${records.find((r) => r.orderId === h.orderId)?.orderNo}${h.shipmentId ? '-' + records.find((r) => r.shipmentId === h.shipmentId)?.seqNo : ''}`).join(', ') || '—'} | containers: ${containers(a.text).join(',') || '—'} | weights: ${weights(a.text).join(',') || '—'} | cues: ${JSON.stringify(subjectCues(a.text.slice(0, 3000), ev.date))} | text: ${a.text.replace(/\s+/g, ' ').slice(0, 160)}`);
      }
      const thread: any[] = await (triage as any).threadRows(ORG, l);
      console.log(`  THREAD: ${thread.map((t) => `[${t.inboxState}${t.orderId ? ' → ' + (records.find((r) => r.shipmentId === t.shipmentId)?.seqNo !== undefined ? `#${records.find((r) => r.shipmentId === t.shipmentId)?.orderNo}-${records.find((r) => r.shipmentId === t.shipmentId)?.seqNo}` : `#${records.find((r) => r.orderId === t.orderId)?.orderNo}`) : ''}] ${subject60(t.subject)} (${t.emailDate?.toISOString().slice(0, 10)})`).join(' ; ') || '—'}`);
      console.log(`  DECISION: ${d.kind}/${d.confidence} target ${d.target ? `#${records.find((r) => r.orderId === d.target!.orderId)?.orderNo}${d.target.shipmentId ? '-' + records.find((r) => r.shipmentId === d.target!.shipmentId)?.seqNo : ''}` : '—'} | check ${d.check.join('; ')} | blocked ${d.blocked.join('; ')} | cands ${d.candidates.map((c) => `${c.ref}(${c.score}: ${c.reasons.join(',')})`).join(' / ')}`);
    }
  });
  await app.close();
}
main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(), 200));
