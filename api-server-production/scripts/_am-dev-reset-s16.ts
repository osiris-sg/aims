/** Round AM — DEV only: undo the half-applied #23 split rehearsal on dev S16 (back to 200 t, no PI, note restored). */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  if ((process.env.DATABASE_URL ?? '').startsWith(process.env.PROD_DATABASE_URL ?? '###')) throw new Error('dev only');
  const so = await p.supplierOrder.findFirst({ where: { organizationId: '222c6494-96ae-42d0-9283-1b5eabf47b42', soNo: 16, year: 2026 }, select: { id: true, notes: true } });
  const notes = (so!.notes ?? '').split('\n').filter((l) => !l.startsWith('Round AM split')).join('\n') || null;
  await p.supplierOrder.update({ where: { id: so!.id }, data: { qtyMt: 200, piNo: null, notes } });
  console.log('dev S16 reset');
  await p.$disconnect();
})();
