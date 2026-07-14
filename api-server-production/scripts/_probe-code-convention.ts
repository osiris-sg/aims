import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
const prisma = createScriptPrisma();
async function main() {
  const rows = await prisma.customer.findMany({
    where: { organizationId: BIOFUEL_ORG_ID, NOT: [{ customerCode: null }, { customerCode: '' }] },
    select: { name: true, customerCode: true }, orderBy: { customerCode: 'asc' }, take: 40,
  });
  for (const r of rows) console.log(`${(r.customerCode || '').padEnd(10)} ${r.name}`);
  const noCode = await prisma.customer.findMany({
    where: { organizationId: BIOFUEL_ORG_ID, OR: [{ customerCode: null }, { customerCode: '' }] },
    select: { name: true }, take: 10,
  });
  console.log('\nno-code examples:', noCode.map(r => r.name).slice(0, 10).join(' | '));
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
