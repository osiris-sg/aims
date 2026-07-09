import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const org = await p.organization.findFirst({ where: { name: { contains: 'Biofuel', mode: 'insensitive' } } });
  if (!org) { console.log('NOT FOUND'); return; }
  console.log('Org:', org.id, '|', org.name);
  const settings = await p.accountingSetting.findUnique({ where: { organizationId: org.id } });
  console.log('settings:', settings ? 'YES — controlAccounts: ' + JSON.stringify(settings.controlAccounts) : 'NO');
  const [coa, cust, sup, jes, bills] = await Promise.all([
    p.chartOfAccount.count({ where: { organizationId: org.id } }),
    p.customer.count({ where: { organizationId: org.id } }),
    p.supplier.count({ where: { organizationId: org.id } }),
    p.journalEntry.count({ where: { organizationId: org.id } }),
    p.bill.count({ where: { organizationId: org.id } }),
  ]);
  console.log({ coa, customers: cust, suppliers: sup, journalEntries: jes, bills });
}
main().finally(() => p.$disconnect());
