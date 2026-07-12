import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const TYPES = ['INVOICE', 'BILL', 'CREDIT_NOTE', 'DEBIT_NOTE'];
async function main() {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: { in: TYPES } }, select: { id: true } });
  const ids = docs.map(d => d.id);
  let msr = 0, msrInv = 0, ord = 0;
  for (let i = 0; i < ids.length; i += 5000) {
    const chunk = ids.slice(i, i + 5000);
    msr += await prisma.maintenanceServiceReport.count({ where: { documentId: { in: chunk } } });
    msrInv += await prisma.maintenanceServiceReport.count({ where: { invoiceDocumentId: { in: chunk } } });
    ord += await prisma.order.count({ where: { sourceQuotationId: { in: chunk } } });
  }
  console.log(`MSR.documentId=${msr}  MSR.invoiceDocumentId=${msrInv}  Order.sourceQuotationId=${ord}`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
