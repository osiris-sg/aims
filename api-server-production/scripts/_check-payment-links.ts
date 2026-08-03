import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true });
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  // customer Payment rows in dev Biofuel
  const custPays = await p.payment.count({ where: { organizationId: ORG } });
  // OR documents
  const ors = await p.document.count({ where: { organizationId: ORG, type: 'OFFICIAL_RECEIPT' } });
  // Xero-imported PAYMENT journals: do they carry sourceDocumentId / sourcePaymentId?
  const payJes = await p.journalEntry.findMany({
    where: { organizationId: ORG, type: 'PAYMENT', journalNumber: { startsWith: 'JV-XERO' } },
    take: 5, select: { journalNumber: true, reference: true, description: true, sourceDocumentId: true, sourcePaymentId: true },
  });
  const payJeCount = await p.journalEntry.count({ where: { organizationId: ORG, type: 'PAYMENT', journalNumber: { startsWith: 'JV-XERO' } } });
  console.log(`customer Payment rows: ${custPays}, OR docs: ${ors}, JV-XERO PAYMENT journals: ${payJeCount}`);
  for (const j of payJes) console.log(' ', JSON.stringify(j));
  // types breakdown of xero journals
  const types = await p.journalEntry.groupBy({ by: ['type'], where: { organizationId: ORG, journalNumber: { startsWith: 'JV-XERO' } }, _count: true });
  console.log('JV-XERO types:', JSON.stringify(types));
}
main().finally(() => p.$disconnect());
