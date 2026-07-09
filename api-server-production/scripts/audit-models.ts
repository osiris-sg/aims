import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  // Models that could plausibly be "documents" — separate top-level vs lives in Document
  const candidates = [
    { name: 'Document(BILL)', q: () => p.document.count({ where: { organizationId: ORG, type: 'BILL' } }) },
    { name: 'Document(INVOICE)', q: () => p.document.count({ where: { organizationId: ORG, type: 'INVOICE' } }) },
    { name: 'Document(QUOTATION)', q: () => p.document.count({ where: { organizationId: ORG, type: 'QUOTATION' } }) },
    { name: 'Document(PO)', q: () => p.document.count({ where: { organizationId: ORG, type: { in: ['PO', 'PURCHASE_ORDER'] } } }) },
    { name: 'Document(DELIVERY_ORDER)', q: () => p.document.count({ where: { organizationId: ORG, type: 'DELIVERY_ORDER' } }) },
    { name: 'Document(SALES_ORDER)', q: () => p.document.count({ where: { organizationId: ORG, type: 'SALES_ORDER' } }) },
    { name: 'Document(CREDIT_NOTE)', q: () => p.document.count({ where: { organizationId: ORG, type: 'CREDIT_NOTE' } }) },
    { name: 'Order (sep table)', q: () => p.order.count({ where: { organizationId: ORG } }) },
    { name: 'Bill (sep, deprecated)', q: () => p.bill.count({ where: { organizationId: ORG } }) },
    { name: 'MaintenanceServiceReport', q: () => p.maintenanceServiceReport.count({ where: { organizationId: ORG } }) },
    { name: 'Payment (AR)', q: () => p.payment.count({ where: { organizationId: ORG } }) },
    { name: 'BillPayment (AP)', q: () => p.billPayment.count({ where: { organizationId: ORG } }) },
    { name: 'BankStatementImport', q: () => p.bankStatementImport.count({ where: { organizationId: ORG } }) },
    { name: 'BankStatementLine', q: () => p.bankStatementLine.count({ where: { organizationId: ORG } }) },
    { name: 'JournalEntry', q: () => p.journalEntry.count({ where: { organizationId: ORG } }) },
    { name: 'ImportInvoice', q: () => p.importInvoice.count({ where: { organizationId: ORG } }) },
  ];
  console.log('Biofuel data per table:');
  for (const c of candidates) {
    try {
      const n = await c.q();
      console.log(`  ${c.name.padEnd(35)} ${n.toLocaleString()}`);
    } catch (e: any) {
      console.log(`  ${c.name.padEnd(35)} ERROR`);
    }
  }
}
main().finally(()=>p.$disconnect());
