import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

// Accounting nav restructured (2026-06-26): split the single "Reports" page into
// General Ledger / Accounts Receivable / Accounts Payable sections + a Reports
// (financials) section. Orgs with a stored ACCOUNTING OrganizationModule row read
// submenus from the DB, so set the canonical new list here. Idempotent.
const NEW_SUBMENUS = [
  { key: 'list', label: 'Dashboard' },
  { key: 'ledger', label: 'General Ledger' },
  { key: 'receivables', label: 'Accounts Receivable' },
  { key: 'payables', label: 'Accounts Payable' },
  { key: 'reports', label: 'Reports' },
  { key: 'setup', label: 'Setup', href: '/portal/settings/accounting-setup' },
];

async function main() {
  const rows = await p.organizationModule.findMany({
    where: { moduleCode: 'ACCOUNTING' },
    select: { id: true, organizationId: true, config: true },
  });
  let patched = 0;
  for (const row of rows) {
    const cfg: any = row.config || {};
    await p.organizationModule.update({
      where: { id: row.id },
      data: { config: { ...cfg, subMenus: NEW_SUBMENUS } },
    });
    patched++;
  }
  console.log(`Set new ACCOUNTING submenus on ${patched} stored module row(s).`);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => p.$disconnect());
