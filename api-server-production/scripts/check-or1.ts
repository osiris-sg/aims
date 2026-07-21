import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const doc = await p.document.findFirst({ where: { organizationId: ORG, type: 'OFFICIAL_RECEIPT', name: 'OR-000001' }, select: { id: true, name: true, config: true } });
  console.log('receipt:', doc?.name, JSON.stringify((doc?.config as any)?.allocations));
  const pays = await p.payment.findMany({ where: { organizationId: ORG, receiptId: doc?.id }, select: { id: true, amount: true, documentId: true, paymentDate: true } });
  console.log('allocation payments:', JSON.stringify(pays));
  const jes = await p.journalEntry.findMany({ where: { organizationId: ORG, sourceDocumentId: doc?.id }, select: { journalNumber: true, status: true, totalDebit: true, totalCredit: true }, orderBy: { createdAt: 'asc' } });
  console.log('journals:', JSON.stringify(jes));
  // all payments on the invoice
  const invPays = await p.payment.findMany({ where: { organizationId: ORG, document: { name: 'BI202406034' } }, select: { amount: true, receiptId: true, reference: true, createdAt: true } });
  console.log('invoice payments:', JSON.stringify(invPays));
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
