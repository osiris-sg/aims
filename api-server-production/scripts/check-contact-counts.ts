import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const custTotal = await p.customer.count({ where: { organizationId: ORG } });
  const custXero = await p.customer.count({ where: { organizationId: ORG, xeroId: { not: null } } });
  const supTotal = await p.supplier.count({ where: { organizationId: ORG } });
  const supXero = await p.supplier.count({ where: { organizationId: ORG, xeroId: { not: null } } });
  console.log(`Customers: ${custTotal} total | ${custXero} from Xero | ${custTotal - custXero} pre-existing only`);
  console.log(`Suppliers: ${supTotal} total | ${supXero} from Xero`);
  const sample = await p.supplier.findMany({ where: { organizationId: ORG, xeroId: { not: null } }, take: 3, select: { name: true, email: true, phone: true, address: true, gstRegNo: true } });
  console.log('\nSample suppliers:');
  sample.forEach(s => console.log(' ', JSON.stringify(s)));
}
main().finally(()=>p.$disconnect());
