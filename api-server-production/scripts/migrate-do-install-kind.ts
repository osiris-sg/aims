import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const r = await p.$executeRaw`UPDATE "MaintenanceServiceReport" SET kind = 'DO_START' WHERE kind = 'DO_INSTALL'`;
  console.log(`Migrated ${r} DO_INSTALL rows → DO_START`);
}
main().finally(()=>p.$disconnect());
