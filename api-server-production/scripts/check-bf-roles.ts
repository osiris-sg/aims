import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  // Find all roles on Biofuel that restrict modules but don't include ACCOUNTING
  const roles = await p.role.findMany({ where: { organizationId: ORG } });
  console.log(`Biofuel roles (${roles.length}):`);
  let needFix = 0;
  for (const r of roles) {
    const allowed = r.allowedModules || [];
    const restricted = allowed.length > 0;
    const hasAcc = allowed.includes('ACCOUNTING');
    console.log(`  ${r.name.padEnd(20)} allowed=${JSON.stringify(allowed)} ${restricted && !hasAcc ? '← needs fix' : ''}`);
    if (restricted && !hasAcc) needFix++;
  }
  console.log(`\n${needFix} roles need ACCOUNTING added.`);
}
main().finally(()=>p.$disconnect());
