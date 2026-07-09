import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = 'osiris-platform';
  const mods = await p.organizationModule.findMany({
    where: { organizationId: ORG },
    select: { moduleCode: true, enabled: true },
    orderBy: { moduleCode: 'asc' },
  });
  console.log('osiris-platform modules:');
  mods.forEach(m => console.log(`  ${m.moduleCode.padEnd(20)} ${m.enabled ? '✓' : '✗'}`));
}
main().finally(()=>p.$disconnect());
