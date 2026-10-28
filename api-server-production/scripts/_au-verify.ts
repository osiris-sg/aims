/** Round AT — READ-ONLY verification after the renumber: List (All), search "#26" / "#26-1", Monthly, next number, #24's PI step, the WhatsApp agent's "#26". */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { PushModule } from '../src/push/push.module';
import { ShipmentsModule } from '../src/shipments/shipments.module';
import { OrdersService } from '../src/shipments/orders.service';
import { ShipmentsService } from '../src/shipments/shipments.service';
import { MonthlyListService } from '../src/shipments/monthly-list.service';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), PushModule, ActionLogModule, ShipmentsModule] })
class M {}
const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
(async () => {
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  await runAsOrg(ORG, async () => {
    const o = app.get(OrdersService);
    const all: any = await o.list(ORG, { bucket: 'all', pageSize: '100' } as any);
    const nos = all.items.map((x: any) => x.orderNo).sort((a: number, b: number) => a - b);
    console.log(`List · All (${all.total}): ${nos.join(', ')}`);
    for (const n of [23, 24, 25, 26, 27, 28]) { const x = all.items.find((i: any) => i.orderNo === n); console.log(`  #${n}: ${x ? `${x.customerName} ${x.grade} ${Number(x.qtyMt)} t ship ${x.shipMonth} deliv ${x.deliveryMonth} ${x.status} was ${JSON.stringify(x.previousOrderNos)} ships ${x.shipments.map((s: any) => s.ref).join(' ') || '-'}` : 'none'}`); }
    for (const q of ['#26', '26', '#23', '#30']) { const r: any = await o.list(ORG, { bucket: 'all', q, pageSize: '10' } as any); console.log(`search "${q}": ${r.items.map((i: any) => `${i.label}${i.was ? ` (was ${i.was})` : ''}`).join(', ') || 'nothing'}`); }
    const s: any = await app.get(ShipmentsService).list(ORG, { q: '#26-1', pageSize: '10' } as any);
    console.log(`shipments search "#26-1": ${s.items.map((i: any) => i.ref ?? i.id).join(', ')}`);
    const hist: any = await o.list(ORG, { bucket: 'completed', q: '#1001', pageSize: '5' } as any);
    console.log(`search "#1001": ${hist.items.map((i: any) => `${i.label} ${i.customerName} ${i.grade}`).join(', ')}`);
    console.log(`next order no. (2026): ${await o.nextOrderNo(ORG, 2026)}`);
    const m: any = await app.get(MonthlyListService).list(ORG, { from: '2026-12', to: '2026-12', basis: 'delivery' } as any);
    console.log(`Monthly · delivery Dec 2026: ${[...new Set(m.blocks.flatMap((b: any) => b.rows.map((r: any) => `${r.client} ${r.orderNo}`)))].join(' | ')}`);
    const ms: any = await app.get(MonthlyListService).list(ORG, { from: '2026-10', to: '2026-12', basis: 'delivery', q: '#26' } as any);
    console.log(`Monthly search "#26": ${[...new Set(ms.blocks.flatMap((b: any) => b.rows.map((r: any) => r.managementNo ?? r.orderNo)))].join(', ')}`);
    const p: any = app.get(PrismaService);
    const n24 = await p.tradeOrder.findFirst({ where: { organizationId: ORG, year: 2026, orderNo: 24 }, select: { status: true, isTest: true, fileLinks: { select: { file: { select: { fileName: true, docType: true } }, step: { select: { displayNo: true, title: true } } } } } });
    console.log(`#24 ${n24.status} test=${n24.isTest} files: ${n24.fileLinks.map((l: any) => `${l.file.fileName} (${l.file.docType}) step ${l.step?.displayNo} ${l.step?.title}`).join('; ')}`);
    const t = await p.tradeOrder.findMany({ where: { organizationId: ORG, year: 2026, orderNo: { gte: 9000 } }, select: { orderNo: true, isTest: true } });
    console.log(`test range: ${t.map((x: any) => `#${x.orderNo}${x.isTest ? ' (hidden)' : ' NOT TEST'}`).join(', ')}`);
    const logs = await p.actionLog.count({ where: { actorId: 'system:round-at-renumber' } });
    const logsOther = await p.actionLog.count({ where: { actorId: 'system:round-at-renumber', organizationId: { not: ORG } } });
    console.log(`Activity Log rows by the renumber: ${logs} (other orgs ${logsOther})`);
  });
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('ERR', e?.message); process.exit(1); });
