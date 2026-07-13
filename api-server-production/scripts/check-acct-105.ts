import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const accts = await p.chartOfAccount.findMany({
    where: { organizationId: ORG, code: { in: ['105'] } },
    select: { id: true, code: true, name: true, accountType: true, isActive: true },
  });
  console.log(JSON.stringify(accts, null, 1));
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
