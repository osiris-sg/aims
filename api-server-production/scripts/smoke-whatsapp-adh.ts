/**
 * Round S smoke (DEV only): drive the WhatsApp shipments assistant end to end against the dev ADH org
 * and print the transcripts. No WhatsApp message is sent — the conversation runs through the web
 * adapter (same Operator, same tools, same Confirm cards) with a preset staff context, exactly what a
 * linked number gets. Also proves: an unlinked number resolves to nothing, the org flag gate, a PDF
 * going through the email intake, the digest text.
 *
 *   TENANCY_MODE=per-org npx ts-node -r tsconfig-paths/register --transpile-only scripts/smoke-whatsapp-adh.ts --org=<dev ADH id> [--keep]
 *
 * Writes: one test ETA change (reverted), one test note (left, stamped "smoke"), one EmailIngestLog row
 * from the generated PDF (purged unless --keep), the smoke session rows (removed).
 */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { PushModule } from '../src/push/push.module';
import { ClerkModule } from '../src/clerk/clerk.module';
import { OperatorModule } from '../src/operator/operator.module';
import { OperatorService } from '../src/operator/operator.service';
import { OperatorAuthService } from '../src/operator/operator-auth.service';
import { WebAdapter } from '../src/operator/adapters/web.adapter';
import { ShipmentsOutboxService } from '../src/operator/shipments-outbox.service';
import { digestText } from '../src/operator/shipments-agent.rules';
import { OperatorContext } from '../src/operator/operator.types';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, ActionLogModule, PushModule, OperatorModule] })
class M {}

const ORG = process.argv.find((a) => a.startsWith('--org='))?.slice(6)!;
const KEEP = process.argv.includes('--keep');
const CHAT = 'smoke:sayaka';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!ORG) throw new Error('--org=<dev ADH org id> is required');
  const app = await NestFactory.createApplicationContext(M, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const operator = app.get(OperatorService);
  const auth = app.get(OperatorAuthService);
  const web = app.get(WebAdapter);
  const outbox = app.get(ShipmentsOutboxService);

  const transcript: string[] = [];
  const say = (line: string) => {
    transcript.push(line);
    console.log(line);
  };
  const lastButtons: { data: string }[] = [];
  web.open(CHAT, (e: any) => {
    if (e?.type !== 'message') return;
    if (e.kind === 'text') say(`  🤖 ${String(e.text).replace(/\n/g, '\n     ')}`);
    else if (e.kind === 'buttons') {
      lastButtons.splice(0, lastButtons.length, ...(e.buttons || []));
      say(`  🤖 ${String(e.text).replace(/\n/g, '\n     ')}\n     [${(e.buttons || []).map((b: any) => b.label).join('] [')}]`);
    } else if (e.kind === 'document') say(`  🤖 📎 ${e.filename} ${e.text ? `· ${e.text}` : ''}`);
    else if (e.kind === 'list') say(`  🤖 ${e.text} [${(e.buttons || []).map((b: any) => b.label).join(' | ')}]`);
  });

  await runAsOrg(ORG, async () => {
    const org = await prisma.organization.findUnique({ where: { id: ORG }, select: { name: true } });
    const ctx: OperatorContext = {
      organizationId: ORG,
      organizationName: org?.name ?? 'ADH',
      clerkUserId: 'smoke_sayaka',
      actor: { id: 'smoke_sayaka', name: 'Sayaka (smoke)' },
      roles: [{ name: 'ADH Staff', permissions: ['shipments:read', 'shipments:update', 'shipments:create', 'documents:read'].map((p) => ({ resource: p.split(':')[0], action: p.split(':')[1] })) }],
      isOsirisAdmin: false,
      channel: 'web',
      channelUserId: CHAT,
    };
    const user = async (text: string, callbackData?: string) => {
      say(`\n  👩 ${callbackData ? `[tap ${callbackData}]` : text}`);
      await operator.handleInbound({ channel: 'web', channelUserId: CHAT, chatId: CHAT, text, callbackData, presetCtx: ctx });
      await sleep(300);
    };
    const tapConfirm = async () => {
      const b = lastButtons.find((x) => x.data.startsWith('confirm:'));
      if (!b) return say('  (no Confirm button was shown)');
      await user('', b.data);
    };
    await prisma.operatorSession.deleteMany({ where: { channelUserId: CHAT } }).catch(() => null);

    // ── 0. safety checks ──
    say('━━ 0. Safety: unlinked number, flag gate');
    const unlinked = await auth.resolve('whatsapp', '10000000000');
    say(`  unlinked number → ok=${unlinked.ok} reason=${unlinked.reason} (no reply, stored in the CRM thread only)`);
    const flag = await prisma.organizationUIConfig.findUnique({ where: { organizationId: ORG }, select: { features: true } });
    say(`  enableWhatsAppAgent on dev ADH = ${((flag?.features as any) ?? {}).enableWhatsAppAgent === true}`);
    say(`  a WhatsApp-channel message with the flag OFF:`);
    const before = transcript.length;
    await operator.handleInbound({ channel: 'whatsapp', channelUserId: '819000000099', chatId: '819000000099', text: 'What came in today?', presetCtx: { ...ctx, channel: 'whatsapp', channelUserId: '819000000099' } });
    await sleep(300);
    say(`  → replies sent: ${transcript.length - before} (expected 0: ignored and logged)`);

    // the records we talk about
    const order: any = await prisma.tradeOrder.findFirst({ where: { organizationId: ORG, status: 'OPEN', NOT: { isTest: true }, shipments: { some: {} } }, orderBy: { orderNo: 'desc' }, select: { id: true, orderNo: true, customer: { select: { name: true } }, shipments: { select: { id: true, seqNo: true, blNumber: true, eta: true, notes: true }, orderBy: { seqNo: 'asc' } } } });
    if (!order) throw new Error('dev ADH has no open order with a shipment');
    const ship = order.shipments[0];
    const ref = `#${order.orderNo}-${ship.seqNo}`;
    say(`\n  (dev records: order #${order.orderNo} ${order.customer?.name ?? ''}, shipment ${ref}, B/L ${ship.blNumber ?? '—'})`);

    // ── 1. conversation A (EN): what came in, status ──
    say('\n━━ 1. Conversation A (English): what came in, status, arrivals');
    await user('What came in today?');
    await user(`Status ${ref}`);
    await user("What's arriving this week?");

    // ── 2. conversation B (JA): needs me, a write with Confirm ──
    say('\n━━ 2. Conversation B (Japanese): 確認待ち, ETA 変更 → 確認ボタン');
    await user('私の確認待ちは？');
    const newEta = '2026-11-28';
    await user(`${ref} の ETA を ${newEta} に変更して`);
    await tapConfirm();
    const after = await prisma.shipment.findUnique({ where: { id: ship.id }, select: { eta: true, etaHistory: true } });
    say(`  ✔ shipment ETA now ${after?.eta?.toISOString().slice(0, 10)} (etaHistory entries: ${Array.isArray(after?.etaHistory) ? (after!.etaHistory as any[]).length : 0})`);
    // revert the test change directly (not via the agent)
    await prisma.shipment.update({ where: { id: ship.id }, data: { eta: ship.eta, etaHistory: (await prisma.shipment.findUnique({ where: { id: ship.id }, select: { etaHistory: true } }))?.etaHistory as any } });
    say(`  (reverted ETA to ${ship.eta ? ship.eta.toISOString().slice(0, 10) : '—'})`);

    // ── 3. conversation C: refusal, note, a document ──
    say('\n━━ 3. Conversation C: a forbidden ask, a note, a document');
    await user(`delete order #${order.orderNo}`);
    await user(`Add a note to ${ref}: smoke test, please ignore`);
    await tapConfirm();
    await user(`Send me the latest document for ${ref}`);

    // ── 4. a PDF sent on WhatsApp → the email intake ──
    say('\n━━ 4. A PDF sent on WhatsApp → same intake as email');
    let pdf: Buffer | null = null;
    try {
      const puppeteer = require('puppeteer');
      const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
      const page = await browser.newPage();
      await page.setContent(`<html><body style="font-family:sans-serif"><h2>DELIVERY NOTE (smoke test)</h2><p>B/L No: ${ship.blNumber ?? 'NONE'}</p><p>Order ${ref} · Asia Deal Hub Japan</p><p>Bundles delivered: 12 · Net 24.0 MT</p></body></html>`);
      pdf = Buffer.from(await page.pdf({ format: 'A4' }));
      await browser.close();
    } catch (e: any) {
      say(`  (puppeteer unavailable: ${e?.message?.slice(0, 80)}; skipping the PDF step)`);
    }
    if (pdf) {
      say(`\n  👩 📎 smoke-delivery-note.pdf (caption: "納品明細")`);
      await operator.handleInbound({ channel: 'web', channelUserId: CHAT, chatId: CHAT, text: '納品明細', presetCtx: ctx, attachment: { dataUri: `data:application/pdf;base64,${pdf.toString('base64')}`, mimetype: 'application/pdf', filename: 'smoke-delivery-note.pdf' } });
      await sleep(300);
      const row: any = await prisma.emailIngestLog.findFirst({ where: { organizationId: ORG, subject: '納品明細', fromAddress: { contains: '@whatsapp' } }, orderBy: { createdAt: 'desc' } });
      say(`  ✔ EmailIngestLog row: state=${row?.inboxState} verdict=${row?.verdict} matched=${row?.orderId ? 'order' : row?.shipmentId ? 'shipment' : '—'} source=${(row?.rawMeta as any)?.source}`);
      if (lastButtons.some((b) => b.data.startsWith('confirm:'))) {
        await user('', lastButtons.find((b) => b.data.startsWith('cancel:'))!.data);
      }
      if (!KEEP && row) {
        await prisma.tradeFile.deleteMany({ where: { organizationId: ORG, emailLogId: row.id } }).catch(() => null);
        await prisma.emailIngestLog.delete({ where: { id: row.id } }).catch(() => null);
        say('  (smoke email row removed)');
      }
    }

    // ── 4b. the audit trail ──
    const logs: any[] = await prisma.actionLog.findMany({ where: { organizationId: ORG, actorId: 'smoke_sayaka' }, orderBy: { createdAt: 'desc' }, take: 10, select: { action: true, resource: true, channel: true, details: true } }).catch(() => []);
    say(`\n━━ 4b. Activity Log rows written as the user (${logs.length}):`);
    for (const l of logs) say(`  · ${l.action} ${l.resource} · channel=${l.channel} · via=${(l.details as any)?.via} · ${String((l.details as any)?.detail ?? '').slice(0, 70)}`);

    // ── 5. the digest ──
    say('\n━━ 5. Morning digest (what Sayaka would get at 08:30 JST)');
    const input = await outbox.digestInput(ORG);
    say('  ' + digestText(input, 'en').replace(/\n/g, '\n  '));
    say('  ---');
    say('  ' + digestText(input, 'ja').replace(/\n/g, '\n  '));

    await prisma.operatorSession.deleteMany({ where: { channelUserId: CHAT } }).catch(() => null);
  });
  web.close(CHAT);
  await app.close();
}
main().catch((e) => { console.error(e?.stack || e?.message || e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(), 300));
