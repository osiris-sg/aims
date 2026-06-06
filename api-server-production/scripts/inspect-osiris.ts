import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const org = await p.organization.findFirst({ where: { name: { contains: 'Osiris Technology', mode: 'insensitive' } } });
  if (!org) { console.log('NOT FOUND'); return; }
  console.log('Org:', org.id, '|', org.name);
  const [coa, customers, suppliers, docs, invoices, payments, bills, fas, ccs, budgets, recur, journals] = await Promise.all([
    p.chartOfAccount.count({ where: { organizationId: org.id } }),
    p.customer.count({ where: { organizationId: org.id } }),
    p.supplier.count({ where: { organizationId: org.id } }),
    p.document.count({ where: { organizationId: org.id } }),
    p.document.count({ where: { organizationId: org.id, type: { in: ['INVOICE','TI'] } } }),
    p.payment.count({ where: { organizationId: org.id } }),
    p.bill.count({ where: { organizationId: org.id } }),
    p.fixedAsset.count({ where: { organizationId: org.id } }),
    p.costCenter.count({ where: { organizationId: org.id } }),
    p.budget.count({ where: { organizationId: org.id } }),
    p.recurringJournalTemplate.count({ where: { organizationId: org.id } }),
    p.journalEntry.count({ where: { organizationId: org.id } }),
  ]);
  console.log(JSON.stringify({ coa, customers, suppliers, docs, invoices, payments, bills, fas, ccs, budgets, recur, journals }, null, 2));
  const settings = await p.accountingSetting.findUnique({ where: { organizationId: org.id } });
  console.log('settings:', settings ? 'YES' : 'NO');
  if (settings) console.log('controlAccounts:', JSON.stringify(settings.controlAccounts));
}
main().finally(() => p.$disconnect());
