import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const org = await p.organization.findFirst({ where: { name: { contains: 'Biofuel', mode: 'insensitive' } } });
  if (!org) return;
  const list = await p.chartOfAccount.findMany({ where: { organizationId: org.id }, take: 5, orderBy: { code: 'asc' } });
  console.log('First 5 accounts for', org.name);
  for (const a of list) console.log(`  ${a.code.padEnd(8)} ${a.name.padEnd(40)} [${a.accountType}]`);
  const total = await p.chartOfAccount.count({ where: { organizationId: org.id } });
  console.log('TOTAL:', total);
}
main().finally(() => p.$disconnect());
