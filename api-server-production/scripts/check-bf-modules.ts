import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const mods = await p.organizationModule.findMany({
    where: { organizationId: ORG },
    select: { moduleCode: true, enabled: true },
    orderBy: { moduleCode: 'asc' },
  });
  console.log('Biofuel modules:');
  mods.forEach(m => console.log(`  ${m.moduleCode.padEnd(20)} ${m.enabled ? '✓' : '✗'}`));
  const acc = mods.find(m => m.moduleCode === 'ACCOUNTING');
  console.log(`\nACCOUNTING module: ${acc ? (acc.enabled ? 'ENABLED' : 'DISABLED') : 'NOT IN org_modules table'}`);
}
main().finally(()=>p.$disconnect());
