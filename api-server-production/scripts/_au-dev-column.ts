/** Round AT — DEV only: TradeOrder.previousOrderNos in every dev schema that has TradeOrder (db push fails on the per-org
 * dev layout). Prod gets it from Render's build. Refuses the prod URL. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
(async () => {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) throw new Error('dev only');
  const p = new PrismaClient();
  const schemas: any[] = await p.$queryRawUnsafe(`select table_schema s from information_schema.tables where table_name='TradeOrder'`);
  for (const { s } of schemas) await p.$executeRawUnsafe(`ALTER TABLE "${s}"."TradeOrder" ADD COLUMN IF NOT EXISTS "previousOrderNos" INTEGER[] DEFAULT ARRAY[]::INTEGER[]`);
  console.log('dev schemas updated:', schemas.map((x) => x.s).join(', '));
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
