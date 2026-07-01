import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

// Bills (AP) moved Inventory → Accounting (2026-06-26). Orgs that have a STORED
// OrganizationModule row read submenus from the DB (mergeModulesWithCatalog uses
// the stored row when present), so the catalog change alone won't move the nav
// for them. This relocates the 'bills' submenu in each org's stored config:
//   INVENTORY.config.subMenus  → remove 'bills'
//   ACCOUNTING.config.subMenus → add { key:'bills', label:'Bills (AP)' } (before 'setup')
// Idempotent.

const keyOf = (s: any) => (typeof s === 'string' ? s : s?.key);

async function main() {
  const orgs = await p.organization.findMany({ select: { id: true, name: true } });
  let invPatched = 0;
  let accPatched = 0;

  for (const org of orgs) {
    const [inv, acc] = await Promise.all([
      p.organizationModule.findFirst({ where: { organizationId: org.id, moduleCode: 'INVENTORY' } }),
      p.organizationModule.findFirst({ where: { organizationId: org.id, moduleCode: 'ACCOUNTING' } }),
    ]);

    // 1) Remove 'bills' from INVENTORY's stored submenus.
    if (inv) {
      const cfg: any = inv.config || {};
      const subs: any[] = Array.isArray(cfg.subMenus) ? cfg.subMenus : [];
      if (subs.some((s) => keyOf(s) === 'bills')) {
        const next = subs.filter((s) => keyOf(s) !== 'bills');
        await p.organizationModule.update({ where: { id: inv.id }, data: { config: { ...cfg, subMenus: next } } });
        invPatched++;
        console.log(`  ${org.name}: removed 'bills' from INVENTORY`);
      }
    }

    // 2) Add 'bills' to ACCOUNTING's stored submenus (before 'setup' if present).
    if (acc) {
      const cfg: any = acc.config || {};
      const subs: any[] = Array.isArray(cfg.subMenus) ? cfg.subMenus : [];
      if (!subs.some((s) => keyOf(s) === 'bills')) {
        const billsItem = { key: 'bills', label: 'Bills (AP)' };
        const setupIdx = subs.findIndex((s) => keyOf(s) === 'setup');
        const next = setupIdx >= 0
          ? [...subs.slice(0, setupIdx), billsItem, ...subs.slice(setupIdx)]
          : [...subs, billsItem];
        await p.organizationModule.update({ where: { id: acc.id }, data: { config: { ...cfg, subMenus: next } } });
        accPatched++;
        console.log(`  ${org.name}: added 'bills' to ACCOUNTING`);
      }
    }
  }

  console.log(`\nDone. INVENTORY patched: ${invPatched}, ACCOUNTING patched: ${accPatched}, orgs scanned: ${orgs.length}`);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => p.$disconnect());
