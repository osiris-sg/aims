import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const r = await p.$queryRaw`SELECT current_database() as db, current_user as user, inet_server_addr()::text as addr`;
  console.log('Connected to:', r);
  const tbl = await p.$queryRaw`SELECT COUNT(*) as n FROM "Document"`;
  console.log('Total Documents in DB (raw count):', tbl);
}
main().finally(()=>p.$disconnect());
