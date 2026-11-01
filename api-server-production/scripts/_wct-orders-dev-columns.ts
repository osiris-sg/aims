/**
 * WCT order flow (2026-11-01, Phases 1–6): the new columns / tables on the DEV
 * database — every schema that has the table (dev runs per-org tenancy and
 * `prisma db push` refuses it; archive_* schemas are skipped). Prod needs
 * nothing: Render's build pushes schema.prisma (public).
 *
 *   npx ts-node --transpile-only scripts/_wct-orders-dev-columns.ts            # dry run: prints the SQL
 *   npx ts-node --transpile-only scripts/_wct-orders-dev-columns.ts --apply    # runs it (IF NOT EXISTS)
 *
 * Refuses to run against PROD_DATABASE_URL's host.
 */
import 'dotenv/config';
import { Client } from 'pg';

const apply = process.argv.includes('--apply');

/** table → columns [name, SQL type] added in every schema that has the table. */
const COLUMNS: Record<string, [string, string][]> = {
  // Phase 1
  Order: [
    ['invoiceDocumentId', 'UUID'],
    ['attachments', 'JSONB'],
  ],
  Delivery: [
    ['orderId', 'UUID'],
    // Phase 2
    ['plannedRiderUserId', 'TEXT'],
    ['plannedRiderName', 'TEXT'],
    // Phase 3
    ['completionMode', 'TEXT'],
    ['completionNote', 'TEXT'],
    ['completionPhotos', 'JSONB'],
    ['verificationState', 'TEXT'],
    ['verifiedAt', 'TIMESTAMP(3)'],
    ['verifiedByUserId', 'TEXT'],
    ['verifiedByName', 'TEXT'],
    ['verificationNote', 'TEXT'],
    // Phase 4
    ['orderInvoiceId', 'TEXT'],
  ],
  // Phase 2
  OrganizationMemberProfile: [['siteclockUserId', 'TEXT']],
  // Phase 6
  CustomField: [['display', 'JSONB']],
};

/** Indexes: [table, index name, column list]. */
const INDEXES: [string, string, string][] = [
  ['Delivery', 'Delivery_organizationId_orderId_idx', '"organizationId", "orderId"'],
  ['Delivery', 'Delivery_organizationId_verificationState_idx', '"organizationId", "verificationState"'],
  ['Delivery', 'Delivery_orderInvoiceId_idx', '"orderInvoiceId"'],
  ['OrganizationMemberProfile', 'OrganizationMemberProfile_organizationId_siteclockUserId_idx', '"organizationId", "siteclockUserId"'],
];

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
    const where: Record<string, string[]> = {};
    for (const t of new Set([...Object.keys(COLUMNS), ...INDEXES.map((i) => i[0]), 'Order'])) where[t] = await schemasOf(t);
    const stmts: string[] = [];
    for (const [table, cols] of Object.entries(COLUMNS)) {
      for (const s of where[table]) for (const [n, t] of cols) stmts.push(`ALTER TABLE "${s}"."${table}" ADD COLUMN IF NOT EXISTS "${n}" ${t}`);
    }
    for (const [table, name, cols] of INDEXES) for (const s of where[table]) stmts.push(`CREATE INDEX IF NOT EXISTS "${name}" ON "${s}"."${table}" (${cols})`);
    // Delivery.orderId → the same schema's Order (ON DELETE SET NULL)
    for (const s of where.Delivery.filter((x) => where.Order.includes(x))) {
      stmts.push(
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Delivery_orderId_fkey' AND connamespace = '${s}'::regnamespace) THEN ALTER TABLE "${s}"."Delivery" ADD CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "${s}"."Order"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$`,
      );
    }
    if (!apply) {
      for (const q of stmts) console.log(q + ';');
      console.log(`\n-- dry run (${Object.entries(where).map(([t, s]) => `${t}: ${s.join(', ')}`).join('; ')}); pass --apply to execute`);
      return;
    }
    for (const q of stmts) await c.query(q);
    for (const [table, cols] of Object.entries(COLUMNS)) {
      for (const s of where[table]) {
        const r = await c.query(`select count(*)::int n from information_schema.columns where table_schema = $1 and table_name = $2 and column_name = any($3)`, [s, table, cols.map((x) => x[0])]);
        console.log(`${s}.${table}: ${r.rows[0].n}/${cols.length} columns present`);
      }
    }
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
