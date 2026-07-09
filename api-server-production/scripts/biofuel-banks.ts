import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const banks = await p.chartOfAccount.findMany({
    where: { organizationId: ORG, OR: [
      { name: { contains: 'Bank', mode: 'insensitive' } },
      { name: { contains: 'Cash', mode: 'insensitive' } },
      { code: { in: ['100','101','102','103','104'] } }
    ]},
    select: { code: true, name: true, accountType: true },
    orderBy: { code: 'asc' },
  });
  console.log('Biofuel bank/cash accounts:');
  banks.forEach(b => console.log(`  ${b.code.padEnd(6)} ${b.name.padEnd(45)} ${b.accountType}`));
}
main().finally(()=>p.$disconnect());
