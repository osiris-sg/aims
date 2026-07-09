import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  // Remove strays from failed runs
  const docs = await p.document.findMany({ where: { organizationId: ORG, name: { startsWith: 'FXTEST' } }, select: { id: true } });
  for (const d of docs) {
    const jes = await p.journalEntry.findMany({ where: { sourceDocumentId: d.id }, select: { id: true } });
    for (const je of jes) { await p.journalEntryLine.deleteMany({ where: { journalEntryId: je.id } }); await p.journalEntry.delete({ where: { id: je.id } }); }
    await p.payment.deleteMany({ where: { documentId: d.id } });
    await p.document.delete({ where: { id: d.id } });
  }
  const del = await p.customer.deleteMany({ where: { organizationId: ORG, name: 'FX TEST CO (USD)' } });
  console.log('cleaned docs:', docs.length, 'customers:', del.count);
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
