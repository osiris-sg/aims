import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const newConfig = {
    route: '/portal/accounting',
    subMenus: [
      { key: 'list', label: 'Dashboard' },
      { key: 'reports', label: 'Reports' },
      { key: 'setup', label: 'Setup', href: '/portal/settings/accounting-setup' },
    ],
  };
  await p.organizationModule.update({
    where: { organizationId_moduleCode: { organizationId: ORG, moduleCode: 'ACCOUNTING' } },
    data: { config: newConfig, displayName: 'Accounting' },
  });
  console.log('Updated ACCOUNTING module: 3 submenu items (Dashboard, Reports, Setup)');
}
main().finally(()=>p.$disconnect());
