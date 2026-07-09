import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const mods = await p.organizationModule.findMany({
    where: { organizationId: ORG, enabled: true },
    select: { moduleCode: true, displayName: true, sortOrder: true, config: true },
    orderBy: { sortOrder: 'asc' },
  });
  console.log('Biofuel enabled modules (sidebar order):');
  mods.forEach(m => {
    const route = (m.config as any)?.route;
    console.log(`  ${String(m.sortOrder).padStart(3)} | ${m.moduleCode.padEnd(20)} → "${m.displayName}" ${route ? `route=${route}` : ''}`);
  });
}
main().finally(()=>p.$disconnect());
