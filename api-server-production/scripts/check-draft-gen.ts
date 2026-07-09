import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const t = await p.recurringInvoiceTemplate.findFirst({ where: { name: 'Recurring — BI2026070003' } });
  if (!t?.lastRunDocumentId) { console.log('no lastRunDocumentId'); return; }
  const doc = await p.document.findUnique({ where: { id: t.lastRunDocumentId }, select: { id: true, name: true, type: true, status: true, projectId: true, projectDeploymentId: true, config: true } });
  const c: any = doc?.config || {};
  console.log('generated doc:', { name: doc?.name, status: doc?.status, projectId: doc?.projectId, projectDeploymentId: doc?.projectDeploymentId });
  console.log('totals:', { subTotal: c.subTotal, gstAmount: c.gstAmount, nettTotal: c.nettTotal }, '| lines:', (c.items || []).length, '| line1:', JSON.stringify({ d: c.items?.[0]?.description?.slice(0, 40), price: c.items?.[0]?.unitPrice, tax: c.items?.[0]?.tax }));
  const je = await p.journalEntry.findFirst({ where: { sourceDocumentId: doc!.id } });
  console.log('journal entry:', je ? `${(je as any).journalNumber} (UNEXPECTED for draft!)` : 'none — correct for draft-first');
  console.log('template after run:', { nextRunDate: t.nextRunDate, lastRunAt: t.lastRunAt, autoSend: t.autoSend });
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
