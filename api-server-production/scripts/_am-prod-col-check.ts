/** Round AM — read-only: is SupplierOrder.forOrderId on prod yet? */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const r: any[] = await p.$queryRawUnsafe(`SELECT table_schema FROM information_schema.columns WHERE table_name = 'SupplierOrder' AND column_name = 'forOrderId'`);
  console.log(r.length ? `PRESENT in ${r.map((x) => x.table_schema).join(',')}` : 'missing');
  await p.$disconnect();
})();
