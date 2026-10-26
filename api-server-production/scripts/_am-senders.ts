/** Round AM — read-only: who emails ADH, per customer / supplier (direction IN, by order's customer). Prints addresses + counts only. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const p = new PrismaClient();
(async () => {
  const rows: any[] = await p.emailIngestLog.findMany({ where: { organizationId: ADH }, select: { fromAddress: true, direction: true, orderId: true, verdict: true, counterparty: true } as any });
  const orders = await p.tradeOrder.findMany({ where: { organizationId: ADH }, select: { id: true, customer: { select: { name: true } }, supplier: { select: { name: true } } } });
  const om = new Map(orders.map((o) => [o.id, o]));
  const agg = new Map<string, { n: number; cust: Set<string>; dir: Set<string>; cp: Set<string> }>();
  for (const r of rows) {
    const a = agg.get(r.fromAddress) ?? { n: 0, cust: new Set(), dir: new Set(), cp: new Set() };
    a.n++; a.dir.add(r.direction ?? '?'); if (r.counterparty) a.cp.add(String(r.counterparty));
    const o = r.orderId ? om.get(r.orderId) : null; if (o) a.cust.add(`${o.customer?.name?.slice(0, 12)}|${o.supplier?.name?.slice(0, 10)}`);
    agg.set(r.fromAddress, a);
  }
  console.log('total', rows.length);
  for (const [k, v] of [...agg.entries()].sort((a, b) => b[1].n - a[1].n)) console.log(v.n, k, [...v.dir].join('/'), [...v.cp].join(','), [...v.cust].join(' ; '));
  await p.$disconnect();
})();
