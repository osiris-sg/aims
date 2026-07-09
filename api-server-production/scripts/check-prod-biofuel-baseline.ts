import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const HARDCODED = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const orgs = await p.organization.findMany({
    where: { name: { contains: 'Biofuel', mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  console.log('Biofuel org(s) in THIS db:');
  for (const o of orgs) console.log(`  ${o.id}  "${o.name}"  ${o.id === HARDCODED ? '<-- matches hardcoded ID' : '*** ID DIFFERS from hardcoded ***'}`);
  const org = orgs[0];
  if (!org) { console.log('NO Biofuel org found.'); return; }
  const id = org.id;
  const [coa, je, jel, cust, supp, bills, invs, tx] = await Promise.all([
    p.chartOfAccount.count({ where: { organizationId: id } }),
    p.journalEntry.count({ where: { organizationId: id } }),
    p.journalEntryLine.count({ where: { journalEntry: { organizationId: id } } }),
    p.customer.count({ where: { organizationId: id } }),
    p.supplier.count({ where: { organizationId: id } }),
    p.document.count({ where: { organizationId: id, type: 'BILL' } }),
    p.document.count({ where: { organizationId: id, type: 'INVOICE' } }),
    p.transaction.count({ where: { organizationId: id } }),
  ]);
  console.log(`\nCurrent Biofuel finance data (org=${id}):`);
  console.log(`  ChartOfAccount : ${coa}`);
  console.log(`  JournalEntry   : ${je}`);
  console.log(`  JE Lines       : ${jel}`);
  console.log(`  Customers      : ${cust}`);
  console.log(`  Suppliers      : ${supp}`);
  console.log(`  Documents BILL : ${bills}`);
  console.log(`  Documents INV  : ${invs}`);
  console.log(`  Transactions   : ${tx}`);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => p.$disconnect());
