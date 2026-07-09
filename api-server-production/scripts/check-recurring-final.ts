import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const doc = await p.document.findFirst({
    where: { organizationId: ORG, type: 'INVOICE', name: { startsWith: 'BIPL-JPSG-INV-' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, status: true, createdAt: true, config: true },
  });
  if (!doc) { console.log('no invoice'); return; }
  const cfg: any = doc.config || {};
  console.log('INVOICE:', doc.name, '| status:', doc.status);
  console.log('line[0]:', JSON.stringify(cfg.items?.[0]));
  console.log('totals:', { subTotal: cfg.subTotal, gstAmount: cfg.gstAmount, nettTotal: cfg.nettTotal });

  const je = await p.journalEntry.findFirst({
    where: { sourceDocumentId: doc.id },
    include: { lines: { include: { account: { select: { code: true, name: true } } } } },
  });
  if (!je) { console.log('NO JOURNAL ENTRY'); return; }
  console.log('\nJE:', (je as any).journalNumber, '| status:', (je as any).status, '| ref:', (je as any).reference);
  for (const l of je.lines as any[]) console.log(`  ${l.account?.code} ${l.account?.name}  Dr ${l.debit}  Cr ${l.credit}`);
  const totDr = (je.lines as any[]).reduce((s, l) => s + Number(l.debit), 0);
  const totCr = (je.lines as any[]).reduce((s, l) => s + Number(l.credit), 0);
  console.log(`balanced: Dr ${totDr} = Cr ${totCr} → ${totDr === totCr}`);

  const t = await p.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG }, select: { nextRunDate: true, lastRunAt: true, lastRunDocumentId: true } });
  console.log('\nTemplate:', t);
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
