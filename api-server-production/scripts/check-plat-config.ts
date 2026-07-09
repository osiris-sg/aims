import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const m = await p.organizationModule.findFirst({ where: { organizationId: 'osiris-platform', moduleCode: 'ACCOUNTING' } });
  console.log('osiris-platform ACCOUNTING:');
  console.log(`  displayName: ${m?.displayName}`);
  console.log(`  config:`, JSON.stringify(m?.config, null, 2));
}
main().finally(()=>p.$disconnect());
