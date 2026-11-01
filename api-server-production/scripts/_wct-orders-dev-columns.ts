/**
 * WCT orders Phase 1 (2026-11-01): add Order.invoiceDocumentId / Order.attachments
 * and Delivery.orderId (+ index + FK to the same schema's Order, ON DELETE SET
 * NULL) on the DEV database — every schema that has those tables (dev runs
 * per-org tenancy and `prisma db push` refuses it). Prod needs nothing: Render's
 * build pushes schema.prisma (public).
 *
 *   npx ts-node --transpile-only scripts/_wct-orders-dev-columns.ts            # dry run: prints the SQL
 *   npx ts-node --transpile-only scripts/_wct-orders-dev-columns.ts --apply    # runs it (IF NOT EXISTS)
 *
 * Refuses to run against PROD_DATABASE_URL's host.
 */
import 'dotenv/config';
import { Client } from 'pg';

const apply = process.argv.includes('--apply');

(async () => {
  const url = process.env.DATABASE_URL || '';
  const prod = process.env.PROD_DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL is not set');
  if (prod && new URL(url).host === new URL(prod.replace(/["\r]/g, '')).host) throw new Error('Refusing: DATABASE_URL is the prod database');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const schemasOf = async (table: string) =>
      (await c.query(`select table_schema from information_schema.tables where table_name = $1 and table_schema not like 'archive%' order by 1`, [table])).rows.map((r) => r.table_schema as string);
    const orderSchemas = await schemasOf('Order');
    const deliverySchemas = (await schemasOf('Delivery')).filter((s) => orderSchemas.includes(s));
    const stmts = [
      ...orderSchemas.flatMap((s) => [
        `ALTER TABLE "${s}"."Order" ADD COLUMN IF NOT EXISTS "invoiceDocumentId" UUID`,
        `ALTER TABLE "${s}"."Order" ADD COLUMN IF NOT EXISTS "attachments" JSONB`,
      ]),
      ...deliverySchemas.flatMap((s) => [
        `ALTER TABLE "${s}"."Delivery" ADD COLUMN IF NOT EXISTS "orderId" UUID`,
        `CREATE INDEX IF NOT EXISTS "Delivery_organizationId_orderId_idx" ON "${s}"."Delivery" ("organizationId", "orderId")`,
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Delivery_orderId_fkey' AND connamespace = '${s}'::regnamespace) THEN ALTER TABLE "${s}"."Delivery" ADD CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "${s}"."Order"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$`,
      ]),
    ];
    if (!apply) {
      for (const q of stmts) console.log(q + ';');
      console.log(`\n-- dry run (Order in ${orderSchemas.join(', ')}; Delivery in ${deliverySchemas.join(', ')}); pass --apply to execute`);
      return;
    }
    for (const q of stmts) await c.query(q);
    for (const s of orderSchemas) {
      const r = await c.query(
        `select count(*)::int n from information_schema.columns where table_schema = $1 and ((table_name = 'Order' and column_name in ('invoiceDocumentId','attachments')) or (table_name = 'Delivery' and column_name = 'orderId'))`,
        [s],
      );
      console.log(`schema ${s}: ${r.rows[0].n}/${deliverySchemas.includes(s) ? 3 : 2} columns present`);
    }
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
