/**
 * SiteClock deliveries (2026-11-06): the two new tables on the DEV database
 * (per-org tenancy: they live in the `platform` schema, like the other SiteClock
 * tables). Prod gets them from Render's build (prisma db push of schema.prisma).
 * Refuses anything but the dev URL from api-server-production/.env.
 *   node scripts/_scd-dev-tables.js           dry run (prints the SQL)
 *   node scripts/_scd-dev-tables.js --apply
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const env = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8');
const devUrl = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.replace(/^"|"$/g, '').replace('-pooler', '');
const prodUrl = (env.match(/^PROD_DATABASE_URL=(.*)$/m) || [])[1]?.replace(/^"|"$/g, '').replace('-pooler', '');
if (!devUrl) throw new Error('no DATABASE_URL in .env');
if (prodUrl && devUrl.split('@')[1]?.split('/')[0] === prodUrl.split('@')[1]?.split('/')[0]) throw new Error('DATABASE_URL points at the prod host: refusing');

const SQL = `
CREATE TABLE IF NOT EXISTS "platform"."DeliveryOpLease" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "op" TEXT NOT NULL,
  "holder" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryOpLease_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DeliveryOpLease_expiresAt_idx" ON "platform"."DeliveryOpLease"("expiresAt");
CREATE TABLE IF NOT EXISTS "platform"."IdempotencyRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "statusCode" INTEGER,
  "response" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "IdempotencyRecord_organizationId_createdAt_idx" ON "platform"."IdempotencyRecord"("organizationId", "createdAt");
`;

(async () => {
  if (!process.argv.includes('--apply')) return console.log(`DRY RUN (dev host ${devUrl.split('@')[1]?.split('/')[0]})\n${SQL}`);
  const c = new Client({ connectionString: devUrl });
  await c.connect();
  await c.query(SQL);
  const r = await c.query(`SELECT table_schema, table_name FROM information_schema.tables WHERE table_name IN ('DeliveryOpLease','IdempotencyRecord') ORDER BY 1,2`);
  console.log('APPLIED on dev:', r.rows.map((x) => `${x.table_schema}.${x.table_name}`).join(', '));
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
