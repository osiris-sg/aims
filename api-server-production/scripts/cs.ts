import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const cust = await p.customer.count({ where: { organizationId: ORG } });
  const custXero = await p.customer.count({ where: { organizationId: ORG, xeroId: { not: null } } });
  const sup = await p.supplier.count({ where: { organizationId: ORG } });
  const supXero = await p.supplier.count({ where: { organizationId: ORG, xeroId: { not: null } } });
  console.log(`Customers:  ${cust} total | ${custXero} with xeroId | ${cust - custXero} without`);
  console.log(`Suppliers:  ${sup} total | ${supXero} with xeroId | ${sup - supXero} without`);
}
main().finally(()=>p.$disconnect());
