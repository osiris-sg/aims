import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const items = await p.revenueItem.findMany({ where: { organizationId: ORG }, select: { code: true, name: true, type: true, accountCode: true, isActive: true, unitPrice: true, taxRate: true } });
  const jp = items.filter((i) => /jurong|port|pass/i.test(i.name));
  console.log('matching services:', JSON.stringify(jp, null, 1));
  console.log('total revenue items:', items.length);
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
