import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const DOC = '8cfa9952-8027-44ff-b88d-aa46b473d794'; // BIPL-JPSG-INV-20260708-0005, confirmed but never posted (pre-fix)
  const TMPL = 'd22d46b2-4a33-4ef9-a39d-9bc099cfda74';

  const je = await p.journalEntry.findFirst({ where: { sourceDocumentId: DOC } });
  if (je) { console.log('Doc has a journal entry — NOT deleting. Abort.'); return; }

  const del = await p.document.deleteMany({ where: { id: DOC, organizationId: ORG } });
  console.log('Deleted stranded test invoice:', del.count);

  const t = await p.recurringInvoiceTemplate.update({
    where: { id: TMPL },
    data: { nextRunDate: new Date('2026-07-07T00:00:00+08:00'), lastRunAt: null, lastRunDocumentId: null },
  });
  console.log('Template reset — nextRunDate:', t.nextRunDate);
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
