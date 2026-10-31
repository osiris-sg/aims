/**
 * Round AY: READ-ONLY dump of dev data for the preview screenshots — an order's Overall process, My tasks and the
 * Monthly list (with the overdue badges). Usage:
 *   TENANCY_MODE=per-org npx ts-node -r tsconfig-paths/register --transpile-only scripts/_ay-preview-dump.ts <out.json> [orderNo]
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import configuration from '../config/configuration';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { ClerkModule } from '../src/clerk/clerk.module';
import { PushModule } from '../src/push/push.module';
import { PushService } from '../src/push/push.service';
import { ShipmentsModule } from '../src/shipments/shipments.module';
import { TradeDueService } from '../src/shipments/trade-due.service';
import { TradeAlertsService } from '../src/shipments/trade-alerts.service';
import { MonthlyListService } from '../src/shipments/monthly-list.service';
import { StaffWhatsAppService } from '../src/staff-whatsapp/staff-whatsapp.service';

const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42';
@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, PushModule, ActionLogModule, ShipmentsModule], providers: [PrismaService] })
class Dump {}
const noop = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : async () => undefined) });

(async () => {
  const url = process.env.DATABASE_URL || '';
  const prod = (process.env.PROD_DATABASE_URL || '').replace(/["\r]/g, '');
  if (prod && new URL(url).host === new URL(prod).host) throw new Error('Refusing: DATABASE_URL is the prod database');
  const mod = await Test.createTestingModule({ imports: [Dump] }).overrideProvider(StaffWhatsAppService).useValue(noop).overrideProvider(PushService).useValue(noop).compile();
  const prisma: any = mod.get(PrismaService);
  const out = await runAsOrg(ORG, async () => {
    const no = Number(process.argv[3] || 0);
    const orders: any[] = await prisma.tradeOrder.findMany({ where: { organizationId: ORG, status: 'OPEN', ...(no ? { orderNo: no } : {}) }, select: { id: true, orderNo: true, _count: { select: { shipments: true } } }, orderBy: { orderNo: 'asc' } });
    const o = orders.sort((a, b) => b._count.shipments - a._count.shipments)[0];
    const proc = await mod.get(TradeDueService).orderProcess(ORG, o.id);
    const tasks = await mod.get(TradeAlertsService).myTasks(ORG);
    const monthly = await mod.get(MonthlyListService).list(ORG, { status: 'Open' } as any);
    return { orderId: o.id, orderNo: o.orderNo, process: proc, tasks, monthly };
  });
  writeFileSync(process.argv[2], JSON.stringify(out));
  console.log(`order #${out.orderNo}: ${out.process.columns.length} columns, ${out.process.rows.length} rows, ${out.process.overdue} overdue; tasks ${out.tasks.length} (${out.tasks.filter((t: any) => t.kind === 'STEP_DUE').length} steps); monthly rows with overdue ${out.monthly.blocks.flatMap((b: any) => b.rows).filter((r: any) => r.overdue).length}`);
  await mod.close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
