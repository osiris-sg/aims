// Add the "Posting Queue" submenu to every org's stored ACCOUNTING module
// config (guru 2026-07-26: queue in the navbar for superadmin/Admin in every
// org, all DBs). Stored OrganizationModule rows override MODULE_CATALOG, so
// orgs seeded before this change need their config.subMenus patched; the
// catalog covers future orgs. `adminOnly: true` makes the sidebar hide the
// entry from non-admin roles.
//
// Idempotent: skips rows that already have a posting-queue submenu. Inserts
// before the 'reports' entry (matching catalog order), else appends.
// Dry run by default; --apply to write. --env dev|staging|prod.
//
// Usage: npx ts-node scripts/add-posting-queue-submenu.ts --env dev --apply

import * as dotenv from 'dotenv';
import * as path from 'path';

const args = process.argv.slice(2);
const ENV = (args[args.indexOf('--env') + 1] || 'dev') as 'dev' | 'staging' | 'prod';
const APPLY = args.includes('--apply');
const envFile = ENV === 'dev' ? '.env' : ENV === 'staging' ? '.env.staging' : '.env.production';
dotenv.config({ path: path.resolve(__dirname, '..', envFile), override: true });

import { PrismaClient } from '@prisma/client';
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const ENTRY = { key: 'posting-queue', label: 'Posting Queue', adminOnly: true };

async function main() {
  console.log(`[${ENV}] ${APPLY ? 'APPLY' : 'dry-run'} — scanning ACCOUNTING module rows...`);
  const rows = await p.organizationModule.findMany({
    where: { moduleCode: 'ACCOUNTING' },
    select: { id: true, organizationId: true, config: true, organization: { select: { name: true } } },
  });
  console.log(`Found ${rows.length} rows.`);

  let patched = 0;
  for (const row of rows) {
    const config = (row.config as any) || {};
    const subMenus: any[] = Array.isArray(config.subMenus) ? config.subMenus : [];
    const has = subMenus.some((s) => (typeof s === 'string' ? s : s?.key) === 'posting-queue');
    if (has) {
      console.log(`  = ${row.organization?.name}: already present`);
      continue;
    }
    const reportsIdx = subMenus.findIndex((s) => (typeof s === 'string' ? s : s?.key) === 'reports');
    const next = [...subMenus];
    if (reportsIdx >= 0) next.splice(reportsIdx, 0, ENTRY);
    else next.push(ENTRY);
    console.log(`  + ${row.organization?.name}: inserting (${subMenus.length} → ${next.length} submenus)`);
    if (APPLY) {
      await p.organizationModule.update({
        where: { id: row.id },
        data: { config: { ...config, subMenus: next } },
      });
    }
    patched++;
  }
  console.log(`${APPLY ? 'Patched' : 'Would patch'} ${patched}/${rows.length} rows.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
