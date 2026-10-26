/** Round AM — DEV only: add SupplierOrder.forOrderId (additive) in the org_adhjapan schema (dev has no public SupplierOrder). Prod gets it from Render's build. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
(async () => {
  if (process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) throw new Error('dev only');
  const p = new PrismaClient();
  for (const schema of ['org_adhjapan']) {
    await p.$executeRawUnsafe(`ALTER TABLE "${schema}"."SupplierOrder" ADD COLUMN IF NOT EXISTS "forOrderId" uuid`);
    console.log(schema, 'ok');
  }
  await p.$disconnect();
})();
