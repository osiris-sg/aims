import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const names = ['CLJ Corporate Secretary Pte Ltd', 'CLJ Solution Pte Ltd', 'Corporate CLJ Pte Ltd', 'OST Technologies Pte Ltd'];
  for (const n of names) {
    try {
      await p.supplier.create({ data: { organizationId: ORG, name: n } });
      console.log('Created:', n);
    } catch (e: any) {
      console.log('Skipped:', n, '-', e.message?.slice(0,80));
    }
  }
}
main().finally(()=>p.$disconnect());
