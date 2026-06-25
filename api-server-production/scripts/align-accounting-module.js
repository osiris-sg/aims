/**
 * Align every org's ACCOUNTING module with the current catalog: rename the
 * legacy "General Ledger" display name to "Accounting" and replace the old
 * 8-page GL submenu with the consolidated Dashboard / Reports / Setup entries.
 * Preserves each org's `enabled` flag and sortOrder.
 *
 * Run against an environment:
 *   node scripts/align-accounting-module.js                          # .env (dev)
 *   dotenv -e .env.production -- node scripts/align-accounting-module.js
 *   dotenv -e .env.staging    -- node scripts/align-accounting-module.js
 */
require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || '.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DISPLAY_NAME = 'Accounting';
const CONFIG = {
  route: '/portal/accounting',
  subMenus: [
    { key: 'list', label: 'Dashboard' },
    { key: 'reports', label: 'Reports' },
    { key: 'setup', label: 'Setup', href: '/portal/settings/accounting-setup' },
  ],
};

(async () => {
  console.log('DB:', new URL(process.env.DATABASE_URL).hostname.split('.')[0]);
  const rows = await prisma.organizationModule.findMany({
    where: { moduleCode: 'ACCOUNTING' },
    select: { id: true, displayName: true, enabled: true, organization: { select: { name: true } } },
  });
  console.log(`Found ${rows.length} ACCOUNTING module rows\n`);
  for (const r of rows) {
    await prisma.organizationModule.update({
      where: { id: r.id },
      data: { displayName: DISPLAY_NAME, config: CONFIG },
    });
    const changed = r.displayName !== DISPLAY_NAME;
    console.log(`  ${r.organization?.name}: "${r.displayName}" -> "${DISPLAY_NAME}" (enabled=${r.enabled})${changed ? '' : ' [name already ok, config refreshed]'}`);
  }
  console.log(`\nDone — ${rows.length} org(s) aligned.`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
