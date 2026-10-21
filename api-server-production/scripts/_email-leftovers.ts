/** Round V — READ-ONLY: the Unprocessed leftovers vs the orders (customer · delivery month · grade · order total · shipments' net). from-domain + subject 60 only. */
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
import { findKeyHits, MatchRecord, recordRef, subjectCues, ownTextCues } from '../src/ingestion-email/email-match.rules';
import { splitQuoted } from '../src/ingestion-email/email-quote';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, ActionLogModule, PushModule, IngestionEmailModule] })
class M {}
const ORG = process.argv.find((a) => a.startsWith('--org='))!.slice(6);
const domainOf = (f: string | null) => (/@([^>\s]+)/.exec(f ?? '')?.[1] ?? '?').toLowerCase().replace(/[>;,]+$/, '');
const s60 = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
async function main() {
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const prisma = app.get(PrismaService); const triage = app.get(EmailTriageService);
  await runAsOrg(ORG, async () => {
    const orders: any[] = await prisma.tradeOrder.findMany({ where: { organizationId: ORG, isTest: false }, orderBy: { orderNo: 'asc' }, select: { orderNo: true, status: true, grade: true, qtyMt: true, tolPct: true, deliveryMonth: true, shipMonth: true, customer: { select: { name: true } }, shipments: { select: { seqNo: true, netWeightMt: true, blNumber: true, status: true } } } });
    console.log('ORDERS:'); for (const o of orders) console.log(`  #${o.orderNo} ${o.status} ${(o.customer?.name ?? '').split(' ')[0]} ${o.grade} ${Number(o.qtyMt)}t ship ${o.shipMonth} → ${o.deliveryMonth} | ${o.shipments.map((s: any) => `#${o.orderNo}-${s.seqNo} ${s.netWeightMt ?? '?'}t ${s.blNumber ?? '-'}`).join(', ')}`);
    const records: MatchRecord[] = await triage.matchRecords(ORG);
    const rows: any[] = await prisma.emailIngestLog.findMany({ where: { organizationId: ORG, inboxState: { in: ['SUGGESTED', 'UNMATCHED', 'UNSURE'] } }, orderBy: { createdAt: 'asc' } });
    console.log(`\nLEFTOVERS (${rows.length}):`);
    for (const r of rows) {
      const ev = await triage.evidence(r); const { own } = splitQuoted(ev.body);
      const hits = findKeyHits(ev, records); const sc = subjectCues(r.subject, ev.date); const oc = ownTextCues(own, records, ev.date);
      const thread: any = await (triage as any).threadContext(ORG, r, records);
      const bls = (t: string) => [...new Set((t.match(/\d{3}[A-Z]{2}\d{5}|\d{9}/g) ?? []))].slice(0, 6);
      const tons = (t: string) => [...new Set((t.match(/\d{1,4}\.\d{3}/g) ?? []))].slice(0, 6);
      console.log(`\n· ${domainOf(r.fromAddress).padEnd(18)} | ${s60(r.subject).padEnd(60)} | ${r.inboxState} | backlog=${r.actions?.backlog?.kind ?? '-'} cp=${r.counterparty}`);
      console.log(`    subject cues: cust=${sc.customers.join('/')} month=${sc.months.join('/')} grades=${sc.grades.join('/')} qty=${sc.qtys.join('/')} multi=${sc.multi} · own cues: grades=${oc.grades.join('/')} qty=${oc.qtys.join('/')} month=${oc.months.join('/')}`);
      console.log(`    own text (${own.length} chars): B/Ls ${bls(own).join(',') || '-'} tons ${tons(own).join(',') || '-'} · keys: ${hits.map((h) => `${h.kind} ${h.value}→${recordRef(records.find((x) => x.orderId === h.orderId && (!h.shipmentId || x.shipmentId === h.shipmentId))!)} [${h.where.join('+')}]`).join('; ') || '-'}`);
      for (const a of ev.attachments) console.log(`    att ${a.name.slice(0, 40)}: text ${a.text.length} chars · B/Ls ${bls(a.text).join(',') || '-'} · tons ${tons(a.text).join(',') || '-'}`);
      console.log(`    thread: accepted=${thread.accepted ? recordRef(records.find((x) => x.orderId === thread.accepted.orderId && (!thread.accepted.shipmentId || x.shipmentId === thread.accepted.shipmentId))!) : '-'} covers=${thread.candidates.map((c: any) => recordRef(records.find((x) => x.orderId === c.orderId && (!c.shipmentId || x.shipmentId === c.shipmentId))!)).join('/') || '-'}`);
    }
  });
  await app.close();
}
main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(), 200));
