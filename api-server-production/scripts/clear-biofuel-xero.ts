import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const res = await p.xeroConnection.deleteMany({ where: { organizationId: ORG } });
  console.log(`Deleted ${res.count} XeroConnection rows for Biofuel`);
}
main().finally(() => p.$disconnect());
