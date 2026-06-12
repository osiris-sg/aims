/**
 * Idempotent migration for two session changes:
 *  1) Create the CustomerContact (POC) table + FK + index.
 *  2) Enable enableQuotationProjectLink for Biofuel orgs (project picker gate).
 *
 * Usage:
 *   node scripts/apply-poc-and-projectflag.js            # uses .env (local/dev)
 *   ENV_FILE=.env.production node scripts/apply-poc-and-projectflag.js
 */
const path = '.env';
require('dotenv').config({ path: process.env.ENV_FILE || path, override: true });
const { PrismaClient } = require('@prisma/client');

(async () => {
  const which = process.env.ENV_FILE || path;
  const host = (process.env.DATABASE_URL || '').replace(/\/\/[^@]*@/, '//***@').replace(/(@[^/]*).*/, '$1');
  console.log(`\n=== Applying to ${which} (${host}) ===`);
  const p = new PrismaClient();
  try {
    // 1) CustomerContact table
    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "CustomerContact" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "phone" text,
        "email" text,
        "designation" text,
        "isPrimary" boolean NOT NULL DEFAULT false,
        "customerId" uuid NOT NULL,
        "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CustomerContact_pkey" PRIMARY KEY ("id")
      );`);
    await p.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "CustomerContact_customerId_idx" ON "CustomerContact"("customerId");',
    );
    await p.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CustomerContact_customerId_fkey') THEN
        ALTER TABLE "CustomerContact" ADD CONSTRAINT "CustomerContact_customerId_fkey"
          FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$;`);
    const cols = await p.$queryRawUnsafe(
      "SELECT column_name FROM information_schema.columns WHERE table_name='CustomerContact' ORDER BY ordinal_position;",
    );
    console.log('  CustomerContact columns:', cols.map((c) => c.column_name).join(', '));

    // 2) Biofuel flag
    const orgs = await p.organization.findMany({
      where: { name: { contains: 'Biofuel', mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (!orgs.length) {
      console.log('  No Biofuel org on this DB — skipping flag.');
    }
    for (const org of orgs) {
      const cfg = await p.organizationUIConfig.findFirst({ where: { organizationId: org.id } });
      if (!cfg) {
        console.log(`  No UIConfig for ${org.name} — skipping.`);
        continue;
      }
      const features = { ...(cfg.features || {}), enableQuotationProjectLink: true };
      await p.organizationUIConfig.update({ where: { id: cfg.id }, data: { features } });
      console.log(`  enableQuotationProjectLink = true for ${org.name} (${org.id})`);
    }
  } finally {
    await p.$disconnect();
  }
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
