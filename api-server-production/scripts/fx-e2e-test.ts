import { PrismaClient } from '@prisma/client';
import { JournalService } from '../src/journal/journal.service';
import { JournalAutoPostService } from '../src/journal/journal-auto-post.service';

const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';

async function main() {
  const journal = new JournalService(p as any, {} as any);
  const svc = new JournalAutoPostService(p as any, journal);

  // 1. Lock standing rate: 1 USD = 1.35 SGD
  const setting = await p.accountingSetting.findUnique({ where: { organizationId: ORG } });
  const originalRates = (setting?.currencyRates as any) ?? null;
  await p.accountingSetting.update({ where: { organizationId: ORG }, data: { currencyRates: { USD: 1.35 } } });
  console.log('1) standing rate locked: 1 USD = 1.35 SGD');

  // 2. USD customer
  const cust = await p.customer.create({ data: { name: 'FX TEST CO (USD)', currency: 'USD', organizationId: ORG, customerCode: 'ZFX' + Math.floor(Math.random() * 90000 + 10000) } as any });
  console.log('2) USD customer created:', cust.name);

  // 3. USD invoice document (face USD 10,000)
  const doc = await p.document.create({
    data: {
      organizationId: ORG, type: 'INVOICE', name: 'FXTEST-' + Math.floor(Math.random() * 90000), status: 'confirmed', documentTemplateId: (await p.documentTemplate.findFirst({ where: { type: 'INVOICE' }, select: { id: true } }))!.id,
      config: { currency: 'USD', customerId: cust.id, customerName: cust.name, subTotal: 10000, gstAmount: 0, nettTotal: 10000, date: '2026-07-10', items: [{ description: 'FX test service', quantity: 1, unitPrice: 10000, amount: 10000, tax: 0 }] },
    } as any,
  });

  // 4. Post the invoice — expect Dr AR 13,500 SGD / Cr Sales 13,500 SGD
  const inv = await svc.postFromInvoice({ organizationId: ORG, documentId: doc.id, invoiceNumber: doc.name, entryDate: new Date('2026-07-10'), customerName: cust.name, netAmount: 10000, taxAmount: 0, grossAmount: 10000 });
  const invFull = await p.journalEntry.findUnique({ where: { id: inv!.id }, include: { lines: { include: { account: { select: { code: true, name: true } } } } } });
  console.log(`4) invoice JE ${invFull!.journalNumber} currency=${invFull!.currency}:`);
  for (const l of invFull!.lines) console.log(`   ${l.account.code} ${l.account.name}: Dr ${l.debit} Cr ${l.credit} | foreign ${l.foreignAmount} @ ${l.exchangeRate}`);

  // 5. Accountant updates the rate to 1.30 — then USD 10,000 settles
  await p.accountingSetting.update({ where: { organizationId: ORG }, data: { currencyRates: { USD: 1.3 } } });
  console.log('5) standing rate updated: 1 USD = 1.30 SGD');
  const pay = await p.payment.create({ data: { organizationId: ORG, customerId: cust.id, documentId: doc.id, amount: 10000, paymentDate: new Date('2026-07-10'), paymentMethod: 'BANK_TRANSFER', reference: 'FXPAY-001', createdBy: 'fx-test' } as any });
  const payJe = await svc.postFromPayment({ organizationId: ORG, paymentId: pay.id, documentId: doc.id, paymentReference: 'FXPAY-001', paymentMethod: 'BANK_TRANSFER', paymentDate: new Date('2026-07-10'), customerName: cust.name, amount: 10000 });
  const payFull = await p.journalEntry.findUnique({ where: { id: payJe!.id }, include: { lines: { include: { account: { select: { code: true, name: true } } } } } });
  console.log(`6) payment JE ${payFull!.journalNumber} currency=${payFull!.currency}:`);
  for (const l of payFull!.lines) console.log(`   ${l.account.code} ${l.account.name}: Dr ${l.debit} Cr ${l.credit} | foreign ${l.foreignAmount ?? '-'} @ ${l.exchangeRate ?? '-'} | ${l.description}`);
  const dr = payFull!.lines.reduce((s, l) => s + l.debit, 0), cr = payFull!.lines.reduce((s, l) => s + l.credit, 0);
  console.log(`   balanced: ${dr} = ${cr} → ${Math.abs(dr - cr) < 0.005}`);

  // 7. Cleanup
  for (const id of [inv!.id, payJe!.id]) {
    await p.journalEntryLine.deleteMany({ where: { journalEntryId: id } });
    await p.journalEntry.delete({ where: { id } });
  }
  await p.payment.delete({ where: { id: pay.id } });
  await p.document.delete({ where: { id: doc.id } });
  await p.customer.delete({ where: { id: cust.id } });
  await p.accountingSetting.update({ where: { organizationId: ORG }, data: { currencyRates: originalRates } });
  console.log('7) cleaned up (test JEs/doc/customer removed, rates restored)');
}
main().catch((e) => console.error('ERR', e.message)).finally(() => p.$disconnect());
