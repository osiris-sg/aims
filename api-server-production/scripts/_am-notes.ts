/** Round AM — read-only: order / shipment notes of ADH (Notes column preview). */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const os = await p.tradeOrder.findMany({ where: { organizationId: '056ed6da-42d3-438e-895b-84bb4df47a4c', isTest: false }, select: { orderNo: true, notes: true, shipments: { select: { seqNo: true, notes: true } } }, orderBy: { orderNo: 'asc' } });
  for (const o of os) console.log(`#${o.orderNo} order: ${JSON.stringify(o.notes)} | ${o.shipments.map((s) => `-${s.seqNo}: ${JSON.stringify(s.notes)}`).join(' ')}`);
  await p.$disconnect();
})();
