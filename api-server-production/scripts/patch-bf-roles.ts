import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const NEW_MODULES = ['ACCOUNTING', 'SUPPLIERS', 'MAINTENANCE'];
  const roles = await p.role.findMany({ where: { organizationId: ORG, name: { in: ['Admin', 'Manager'] } } });
  for (const r of roles) {
    const current = r.allowedModules || [];
    const toAdd = NEW_MODULES.filter(m => !current.includes(m));
    if (toAdd.length === 0) { console.log(`${r.name}: nothing to add`); continue; }
    const updated = [...current, ...toAdd];
    await p.role.update({ where: { id: r.id }, data: { allowedModules: updated } });
    console.log(`${r.name}: added [${toAdd.join(', ')}] → ${JSON.stringify(updated)}`);
  }
}
main().finally(()=>p.$disconnect());
