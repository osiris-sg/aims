import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const r = await p.$queryRaw`SELECT count(*)::int as n FROM "MaintenanceServiceReport" WHERE kind = 'DO_INSTALL'`;
  console.log('DO_INSTALL kind rows:', r);
}
main().finally(()=>p.$disconnect());
