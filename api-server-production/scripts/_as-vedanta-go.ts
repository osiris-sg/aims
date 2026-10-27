/**
 * Round AS — owner's GO on the Vedanta email "RE: Request for the development of Packing list for one budle having
 * different batch" (26 Oct): COA 265C1186 → #16-1 COA slot, AUTOMATIC COA → #19-2 COA slot, the inline image not filed,
 * "COA 265C1701,265C1689 SUS 26th Oct.pdf" not filed but KEPT WAITING, the email linked to #16-1 and #19-2, and the
 * Vedanta issue (Show on step 4 COA). Before / after: #16-1's SUS COA summary preview (read-only). Writes go through
 * the Answer flow (Activity Log rows) and are listed in the script log. Dry run unless --apply.
 */
import 'dotenv/config';
import * as fs from 'fs';
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
import { TradeGeneratedService } from '../src/shipments/trade-generated.service';
import { SUS_COA_TEMPLATE } from '../src/shipments/trade-sus-formats';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), PushModule, ActionLogModule, ClerkModule, IngestionEmailModule] })
class M {}
const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const EMAIL = 'ba03dfb5-353a-4f08-bea0-b586d3eb1864';
const APPLY = process.argv.includes('--apply');
const OUT = process.argv.find((a) => a.startsWith('--out='))!.slice(6);
const DRAFT = JSON.parse(fs.readFileSync(process.argv.find((a) => a.startsWith('--draft='))!.slice(8), 'utf8'));
const ACTOR = { id: 'user_3DvmLZZRYbpmG0ot0iOUUaX9zR8', name: "Elroy (owner's go, round AS)" };
(async () => {
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const log: any[] = [];
  await runAsOrg(ORG, async () => {
    const prisma = app.get(PrismaService);
    const triage = app.get(EmailTriageService);
    const gen = app.get(TradeGeneratedService);
    const ship = async (orderNo: number, seq: number) => prisma.shipment.findFirstOrThrow({ where: { organizationId: ORG, seqNo: seq, order: { orderNo, year: 2026 } }, select: { id: true, orderId: true, blNumber: true } });
    const s16 = await ship(16, 1);
    const s19 = await ship(19, 2);
    console.log(`#16-1 ${s16.blNumber} · #19-2 ${s19.blNumber}`);
    const email: any = await prisma.emailIngestLog.findFirstOrThrow({ where: { id: EMAIL, organizationId: ORG } });
    const atts = ((email.rawMeta?.attachments ?? []) as any[]).map((a) => a.name);
    console.log(`email ${email.inboxState}: ${atts.join(' | ')}`);
    const idx = (n: string) => { const i = atts.indexOf(n); if (i < 0) throw new Error(`no attachment ${n}`); return i; };
    const before = await gen.previewFormat(ORG, s16.id, 'CUSTOMER_COA', SUS_COA_TEMPLATE);
    fs.writeFileSync(`${OUT}/before-16-1.html`, before.html);
    console.log(`BEFORE #16-1 SUS COA summary (source ${before.source}): notes: ${before.notes.join(' | ')}`);
    const t16 = { orderId: s16.orderId, shipmentId: s16.id };
    const t19 = { orderId: s19.orderId, shipmentId: s19.id };
    const answer: any = {
      kind: 'general',
      targets: [t16, t19],
      issue: { title: DRAFT.title, summaryEn: DRAFT.summaryEn, summaryJa: DRAFT.summaryJa, supplierId: DRAFT.supplierId, effectiveFrom: DRAFT.effectiveFrom, docTypes: ['CUSTOMER_COA'], shipmentIds: [], orderIds: [] },
      files: [
        { emailId: EMAIL, index: idx('~WRD2740.jpg'), targets: [] },
        { emailId: EMAIL, index: idx('AUTOMATIC COA.pdf'), targets: [t19], docType: 'COA' },
        { emailId: EMAIL, index: idx('COA 265C1186 SUS 26th Oct.pdf'), targets: [t16], docType: 'COA' },
        { emailId: EMAIL, index: idx('COA 265C1701,265C1689 SUS 26th Oct.pdf'), targets: [], docType: 'COA', wait: true },
      ],
    };
    console.log('answer:', JSON.stringify({ ...answer, issue: { ...answer.issue, summaryEn: '…', summaryJa: '…' } }));
    if (!APPLY) { console.log('DRY RUN — nothing written'); return; }
    const r = await triage.answer(ORG, { ids: [EMAIL], answer }, ACTOR, 'en');
    console.log('RESULT:', r.text);
    log.push({ at: new Date().toISOString(), action: 'ANSWER', email: EMAIL, result: r.text, issue: r.issue });
    const after: any = await prisma.emailIngestLog.findFirstOrThrow({ where: { id: EMAIL } });
    const done = ((after.actions?.done ?? []) as any[]).map((x) => ({ kind: x.kind, status: x.status, file: x.filename, docType: x.docType, ownerId: x.ownerId, fileId: x.fileId, linkId: x.linkId, reason: x.reason }));
    for (const d of done) log.push({ at: new Date().toISOString(), action: d.status === 'done' ? 'FILE' : 'SKIP', ...d });
    log.push({ at: new Date().toISOString(), action: 'WAITING', waiting: after.actions?.waiting });
    console.log(`email now ${after.inboxState}; targets ${JSON.stringify(after.actions?.targets?.map((t: any) => t.shipmentId))}`);
    console.log('done:', JSON.stringify(done, null, 1));
    console.log('waiting:', JSON.stringify(after.actions?.waiting));
    // The script's own Activity Log row (the answer wrote its own rows too).
    app.get(ActionLogService).system('round-as-go', 'PROCESS', 'EmailIngestLog', { organizationId: ORG, resourceId: EMAIL, details: { by: ACTOR.name, files: done.filter((d) => d.status === 'done').map((d) => `${d.file} → ${d.ownerId === s16.id ? '#16-1' : d.ownerId === s19.id ? '#19-2' : d.ownerId}`), waiting: 'COA 265C1701,265C1689 SUS 26th Oct.pdf', issue: r.issue?.title } });
    const afterHtml = await gen.previewFormat(ORG, s16.id, 'CUSTOMER_COA', SUS_COA_TEMPLATE);
    fs.writeFileSync(`${OUT}/after-16-1.html`, afterHtml.html);
    console.log(`AFTER #16-1 notes: ${afterHtml.notes.join(' | ')}`);
    await new Promise((res) => setTimeout(res, 3000));
  });
  fs.writeFileSync('scripts/_as-vedanta-go.log.json', JSON.stringify(log, null, 1));
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('ERR', e?.message); process.exit(1); });
