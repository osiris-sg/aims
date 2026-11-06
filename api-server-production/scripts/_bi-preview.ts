/** Round BI — READ-ONLY preview dump of #18 / #18-1 (step 7) from prod (DBURL inline, TENANCY_MODE=); any write throws. --out=<json> */
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { OrdersService } from '../src/shipments/orders.service';
import { ShipmentsService } from '../src/shipments/shipments.service';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { TradeGeneratedService } from '../src/shipments/trade-generated.service';

const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const out = process.argv.find((a) => a.startsWith('--out='))!.slice(6);
const WRITES = /^(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe|\$transaction)$/;
function readOnly(p: PrismaClient): any {
  return new Proxy(p as any, {
    get(t, k: string) {
      if (WRITES.test(k)) throw new Error(`read-only: ${k}`);
      const v = t[k];
      if (v && typeof v === 'object' && !k.startsWith('$'))
        return new Proxy(v, { get: (m, op: string) => { if (WRITES.test(op)) throw new Error(`read-only: ${k}.${op}`); const f = m[op]; return typeof f === 'function' ? f.bind(m) : f; } });
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}
(async () => {
  const raw = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  const prisma = readOnly(raw);
  const config = new TradeConfigService(prisma);
  const o = await raw.tradeOrder.findFirst({ where: { organizationId: ORG, orderNo: 18 }, select: { id: true, shipments: { where: { seqNo: 1 }, select: { id: true } } } });
  const sid = o!.shipments[0].id;
  const order = await new OrdersService(prisma, config, {} as any).getById(ORG, o!.id);
  const ship = await new ShipmentsService(prisma, config).getById(ORG, sid);
  const gen = Object.create(TradeGeneratedService.prototype);
  Object.assign(gen, { prisma, config });
  const genS = await gen.list(ORG, { shipmentId: sid }).catch((e: Error) => (console.log('gen list', e.message), []));
  const genO = await gen.list(ORG, { orderId: o!.id }).catch(() => []);
  fs.writeFileSync(out, JSON.stringify({ orderDetail: { [o!.id]: order }, shipmentDetail: { [sid]: ship }, genBy: { [sid]: genS, [o!.id]: genO }, customers: [], suppliers: [] }));
  const st7 = (ship as any).steps.find((x: any) => x.code === 'CUSTOMS_TAX_ESTIMATE');
  console.log(JSON.stringify({ order: o!.id, sid, step7: st7?.id, est: (ship as any).estimate?.importTax, net: (ship as any).estimate?.qtyMt, gross: (ship as any).estimate?.grossMt, trucks: (ship as any).estimate?.trucks, gens: genS.length }));
  await raw.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
