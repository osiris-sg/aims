import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const newConfig = {
    route: '/portal/accounting',
    subMenus: [
      { key: 'list', label: 'Dashboard' },
      { key: 'reports', label: 'Reports' },
      { key: 'setup', label: 'Setup', href: '/portal/settings/accounting-setup' },
    ],
  };
  // Patch ALL orgs whose ACCOUNTING module still has the legacy 8-item submenu.
  const all = await p.organizationModule.findMany({ where: { moduleCode: 'ACCOUNTING' } });
  let n = 0;
  for (const m of all) {
    const subs = (m.config as any)?.subMenus || [];
    if (subs.length > 3) {
      await p.organizationModule.update({
        where: { id: m.id },
        data: { config: newConfig, displayName: 'Accounting' },
      });
      console.log(`Patched org=${m.organizationId} (had ${subs.length} subMenus)`);
      n++;
    }
  }
  console.log(`\nDone. Patched ${n} orgs.`);
}
main().finally(()=>p.$disconnect());
