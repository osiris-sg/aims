/** Round AM — DEV only: set forOrderId on dev S20 (the rehearsal's split order; the per-org client dropped it before regeneration). */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42';
  const o = await p.tradeOrder.findFirst({ where: { organizationId: ORG, orderNo: 23 }, select: { id: true } });
  const r = await p.supplierOrder.updateMany({ where: { organizationId: ORG, soNo: 20, year: 2026, forOrderId: null }, data: { forOrderId: o!.id } });
  console.log('dev S20 forOrderId set:', r.count);
  await p.$disconnect();
})();
