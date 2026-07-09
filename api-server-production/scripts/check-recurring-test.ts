import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';

  const doc = await p.document.findFirst({
    where: { organizationId: ORG, name: 'BIPL-JPSG-INV-20260708-0005' },
    select: { id: true, name: true, type: true, status: true, createdAt: true, config: true },
  });
  if (!doc) { console.log('Invoice not found'); return; }
  const cfg: any = doc.config || {};
  console.log('=== INVOICE ===');
  console.log({ id: doc.id, name: doc.name, type: doc.type, status: doc.status, createdAt: doc.createdAt });
  console.log('customer:', cfg.customerId || cfg.customer?.id, '|', cfg.customerName || cfg.customer?.name);
  console.log('currency:', cfg.currency, '| issueDate:', cfg.issueDate || cfg.invoiceDate, '| dueDate:', cfg.dueDate);
  console.log('recurring source:', cfg.recurringTemplateId || cfg.recurringInvoiceTemplateId || '(none marked)');
  const items = cfg.items || cfg.lineItems || [];
  console.log('lines:', JSON.stringify(items, null, 2).slice(0, 1500));
  console.log('gst/tax fields:', JSON.stringify({ gst: cfg.gst, tax: cfg.tax, taxRate: cfg.taxRate, gstRate: cfg.gstRate, totals: cfg.totals, subtotal: cfg.subtotal, total: cfg.total }));

  const jes = await p.journalEntry.findMany({
    where: { organizationId: ORG, OR: [ { sourceDocumentId: doc.id }, { reference: { contains: '0005' } } ] },
    include: { lines: { include: { account: { select: { code: true, name: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });
  console.log(`\n=== JOURNAL ENTRIES linked (${jes.length}) ===`);
  for (const je of jes) {
    console.log({ journalNumber: (je as any).journalNumber, status: (je as any).status, date: (je as any).date ?? (je as any).entryDate, reference: (je as any).reference, sourceDocumentId: (je as any).sourceDocumentId });
    for (const l of je.lines as any[]) {
      console.log(`  ${l.account?.code} ${l.account?.name}  Dr ${l.debit}  Cr ${l.credit}  ${l.description ?? ''}`);
    }
  }

  const tmpl = await p.recurringInvoiceTemplate.findFirst({
    where: { organizationId: ORG },
    orderBy: { createdAt: 'desc' },
  });
  console.log('\n=== RECURRING TEMPLATE ===');
  console.log(JSON.stringify(tmpl, null, 2).slice(0, 2000));
}
main().catch(e => { console.error(e.message); }).finally(() => p.$disconnect());
