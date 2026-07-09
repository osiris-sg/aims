import { PrismaClient } from '@prisma/client';
import { XeroReportsService } from '../src/statements/xero-reports.service';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const svc = new XeroReportsService(p as any);
  const aged = await svc.aged(ORG, 'receivable', { asOf: '2026-07-31', periods: 4, periodDays: 30, ageingBy: 'dueDate', level: 'summary' });
  console.log('AR aged summary: rows =', aged.data.rows?.length, '| grandTotal =', aged.data.grandTotal, '| buckets =', aged.data.bucketLabels.join(' | '));
  console.log('totals:', aged.data.totals);
  const aSmart = aged.data.rows?.find((r: any) => r.contactName.startsWith('A-Smart'));
  console.log('A-Smart Life row (Xero shows 1,526.00 Older):', JSON.stringify(aSmart));

  const detail = await svc.aged(ORG, 'receivable', { asOf: '2026-07-31', level: 'detail' });
  console.log('\ndetail groups =', (detail.data as any).groups?.length);

  const inv = await svc.invoiceReport(ORG, 'receivable', { from: '2026-07-01', to: '2026-07-31' });
  console.log('\ninvoice-report July: groups =', inv.data.groups.length, '| totals =', JSON.stringify(inv.data.totals), '| docs =', inv.data.documentCount);

  const iebc = await svc.incomeExpenseByContact(ORG, { to: '2026-07-31', compareMonths: 4 });
  console.log('\nincome-expense columns:', iebc.data.columns.join(', '), '| rows =', iebc.data.rows.length);
  console.log('income totals:', iebc.data.totals.income, '\nexpense totals:', iebc.data.totals.expense);
}
main().catch(e => { console.error('ERR', e.message); }).finally(() => p.$disconnect());
