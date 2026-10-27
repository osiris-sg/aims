/**
 * Round AR — READ-ONLY dry run on the Vedanta email "RE: Request for the development of Packing list for one budle
 * having different batch" (26 Oct): which shipments the casts / bundles belong to, where each PDF would go, and the
 * proposed Vedanta issue. Nothing is written (no answer applied; the cast index is in memory). The issue draft calls the model.
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
import { TradeCastIndexService } from '../src/shipments/trade-cast-index';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), PushModule, ActionLogModule, ClerkModule, IngestionEmailModule] })
class M {}
const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
(async () => {
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  await runAsOrg(ORG, async () => {
    const prisma = app.get(PrismaService);
    const triage = app.get(EmailTriageService);
    const logs: any[] = await prisma.emailIngestLog.findMany({ where: { organizationId: ORG, subject: { contains: 'one budle having different batch', mode: 'insensitive' } }, orderBy: { createdAt: 'asc' }, select: { id: true, subject: true, fromAddress: true, emailDate: true, inboxState: true, counterparty: true, orderId: true, shipmentId: true, rawMeta: true } });
    console.log(`emails in the thread: ${logs.length}`);
    for (const l of logs) console.log(`  ${l.id} ${String(l.emailDate ?? '').slice(0, 24)} ${(/@([^>\s]+)/.exec(l.fromAddress ?? '')?.[1] ?? '').toLowerCase()} ${l.inboxState} ${l.counterparty ?? '-'} files: ${((l.rawMeta?.attachments ?? []) as any[]).map((a) => a.name).join(' | ')}`);
    const holders = await app.get(TradeCastIndexService).holders(ORG);
    const ref = await prisma.shipment.findMany({ where: { organizationId: ORG, id: { in: holders.map((h) => h.shipmentId) } }, select: { id: true, seqNo: true, blNumber: true, status: true, order: { select: { orderNo: true } } } });
    const refOf = (id: string) => { const s = ref.find((x) => x.id === id); return s ? `#${s.order?.orderNo}-${s.seqNo} (${s.blNumber}, ${s.status})` : id; };
    console.log(`\ncast index: ${holders.length} shipments with a PL / COA`);
    for (const k of ['265C1186', '265C1190', '265C1701', '265C1689', '265C1346', '265C118614', '265C134618', '265C170109', '265C168914']) {
      const hit = holders.filter((h) => (k.length === 10 ? h.batches.has(k) : h.casts.has(k)));
      console.log(`  ${k}: ${hit.map((h) => refOf(h.shipmentId)).join(', ') || 'on no shipment\'s PL / COA'}`);
    }
    const ids = logs.map((l) => l.id);
    const p = await triage.placements(ORG, ids, []);
    console.log('\nplacements (no shipment picked yet):');
    for (const f of p.files) console.log(`  ${f.name}${f.inline ? ' (inline image)' : ''} · slot ${f.docType ?? '—'} · keys ${f.keys.join(',') || '-'} · bundles ${f.bundles.join(',') || '-'}\n      → default ${f.defaults.map((d) => `${d.ref} (${d.why})`).join('; ') || 'none — you pick'}${f.holders.length ? ` · on: ${f.holders.map((h) => `${h.ref} (${h.why})`).join('; ')}` : ''}`);
    const newest = await prisma.emailIngestLog.findFirst({ where: { id: ids[ids.length - 1] } });
    const ev = await triage.evidence(newest);
    const multi = await triage.exactShipments(ORG, ev);
    console.log(`\nexact shipments named by the newest email: ${multi.map((m) => `${refOf(m.shipmentId)} — ${m.why}`).join('; ') || 'none'}`);
    const draft = await triage.issueDraft(ORG, ids);
    console.log('\nissue draft:', JSON.stringify(draft, null, 2));
  });
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('ERR', e?.message); process.exit(1); });
