import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const total = await p.document.count({ where: { organizationId: ORG, type: 'BILL' } });
  console.log(`BILL docs in Biofuel: ${total} (of ~2,456 target)`);
}
main().finally(()=>p.$disconnect());
