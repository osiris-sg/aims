// Org groups (WCT 2026-11-17): add Organization.parentOrgId + its plain index to the DEV database.
// Dev runs per-org tenancy (Organization lives in schema "platform"; `db push` fails there), so this adds the
// column by raw SQL. Prod gets it from Render's build (prisma db push of schema.prisma). Additive, idempotent.
//   node scripts/_org-group-dev-column.js            (dry run: says what it would do)
//   node scripts/_org-group-dev-column.js --apply
require('dotenv').config({ path: __dirname + '/../.env' });
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
(async () => {
  const url = process.env.DATABASE_URL;
  if (!url || url === process.env.PROD_DATABASE_URL) throw new Error('refusing: this is for the dev DB only');
  const c = new Client({ connectionString: url });
  await c.connect();
  const schemas = (await c.query(`select table_schema from information_schema.tables where table_name='Organization' and table_schema in ('platform','public') order by 1`)).rows.map((r) => r.table_schema);
  if (!schemas.length) throw new Error('no Organization table found');
  for (const s of schemas) {
    const has = (await c.query(`select 1 from information_schema.columns where table_schema=$1 and table_name='Organization' and column_name='parentOrgId'`, [s])).rowCount > 0;
    console.log(`${s}."Organization".parentOrgId: ${has ? 'present' : 'missing'}`);
    if (!APPLY) continue;
    await c.query(`ALTER TABLE "${s}"."Organization" ADD COLUMN IF NOT EXISTS "parentOrgId" TEXT`);
    await c.query(`CREATE INDEX IF NOT EXISTS "Organization_parentOrgId_idx" ON "${s}"."Organization"("parentOrgId")`);
    console.log(`${s}: column + index ready`);
  }
  if (!APPLY) console.log('DRY RUN: no change. Re-run with --apply.');
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
