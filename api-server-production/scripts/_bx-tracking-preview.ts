/**
 * Round BX — READ-ONLY preview fixture for the sticky bar's shipment switcher and the Tracking list (from _bw-sticky-preview.ts):
 * order #n (--order=<no>) with EVERY shipment's detail, and the Tracking list. Prod DBURL inline, TENANCY_MODE=; model writes are
 * skipped (no DB call), $-writes throw. --out=<json>
 */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { OrdersService } from '../src/shipments/orders.service';
import { ShipmentsService } from '../src/shipments/shipments.service';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { TradeDueService } from '../src/shipments/trade-due.service';
import { TradeTaxInputsService } from '../src/shipments/trade-tax-inputs';
import { TradeGeneratedService } from '../src/shipments/trade-generated.service';

const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const WRITES = /^(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe|\$transaction)$/;
function readOnly(p: PrismaClient): any {
  return new Proxy(p as any, {
    get(t, k: string) {
      if (WRITES.test(k)) throw new Error(`read-only: ${k}`);
      const v = t[k];
      if (v && typeof v === 'object' && !k.startsWith('$'))
        return new Proxy(v, { get: (m, op: string) => { if (WRITES.test(op)) return async () => (console.log(`skipped write ${k}.${op}`), null); const f = m[op]; return typeof f === 'function' ? f.bind(m) : f; } });
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}
(async () => {
  const raw = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  const prisma = readOnly(raw);
  const config = new TradeConfigService(prisma);
  const due = new TradeDueService(prisma);
  const shipments = new ShipmentsService(prisma, config, undefined, undefined, undefined, new TradeTaxInputsService(prisma));
  const orders = new OrdersService(prisma, config, shipments, undefined, due);
  const o = await raw.tradeOrder.findFirst({ where: { organizationId: ORG, orderNo: Number(arg('order') ?? 25) }, select: { id: true, shipments: { orderBy: { seqNo: 'asc' }, select: { id: true } } } });
  const order = await orders.getById(ORG, o!.id);
  const gen = Object.create(TradeGeneratedService.prototype);
  Object.assign(gen, { prisma, config });
  const shipmentDetail: Record<string, unknown> = {};
  const genBy: Record<string, unknown> = { [o!.id]: await gen.list(ORG, { orderId: o!.id }).catch(() => []) };
  for (const { id } of o!.shipments) {
    shipmentDetail[id] = await shipments.getById(ORG, id);
    genBy[id] = await gen.list(ORG, { shipmentId: id }).catch(() => []);
  }
  const proc = await due.orderProcess(ORG, o!.id);
  const tracking = await shipments.tracking(ORG);
  fs.writeFileSync(arg('out')!, JSON.stringify({ orderDetail: { [o!.id]: order }, shipmentDetail, genBy, process: { [o!.id]: proc }, tracking, customers: [], suppliers: [] }));
  const steps = Object.fromEntries(Object.entries(shipmentDetail).map(([id, sh]: [string, any]) => [id, sh.steps.find((x: any) => x.code === 'CUSTOMS_TAX_ESTIMATE')?.id]));
  console.log(JSON.stringify({ order: o!.id, shipments: o!.shipments.map((x) => x.id), step7: steps, tracking: tracking.items.length, delayed: tracking.items.filter((r) => r.delayed).length }));
  await raw.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
