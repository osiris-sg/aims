import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const TMPL = 'd22d46b2-4a33-4ef9-a39d-9bc099cfda74';

  const doc = await p.document.findFirst({ where: { organizationId: ORG, name: 'BIPL-JPSG-INV-20260708-0006' }, select: { id: true } });
  if (doc) {
    const je = await p.journalEntry.findFirst({ where: { sourceDocumentId: doc.id }, select: { id: true, journalNumber: true } });
    if (je) {
      await p.journalEntryLine.deleteMany({ where: { journalEntryId: je.id } });
      await p.journalEntry.delete({ where: { id: je.id } });
      console.log('Deleted test JE', je.journalNumber);
    }
    await p.document.delete({ where: { id: doc.id } });
    console.log('Deleted test invoice 0006');
  } else {
    console.log('Invoice 0006 not found');
  }

  const t = await p.recurringInvoiceTemplate.update({
    where: { id: TMPL },
    data: { nextRunDate: new Date('2026-07-07T00:00:00+08:00'), lastRunAt: null, lastRunDocumentId: null },
  });
  console.log('Template reset — nextRunDate:', t.nextRunDate);
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
