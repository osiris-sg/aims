import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const TYPES = ['INVOICE', 'BILL', 'CREDIT_NOTE', 'DEBIT_NOTE'];
async function main() {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: { in: TYPES } }, select: { id: true, type: true, documentTemplateId: true } });
  const ids = docs.map(d => d.id);
  console.log(`target docs: ${ids.length}`);
  const tmap = new Map<string, Set<string>>();
  for (const d of docs) { if (!tmap.has(d.type)) tmap.set(d.type, new Set()); tmap.get(d.type)!.add(d.documentTemplateId ?? 'null'); }
  for (const [t, s] of tmap) console.log(`  ${t} templateIds:`, [...s].join(', '));
  const billTmpls = await prisma.documentTemplate.findMany({ where: { organizationId: ORG, type: 'BILL' }, select: { id: true, name: true } });
  console.log('BILL templates in dev:', billTmpls.map(t => `${t.id} (${t.name})`).join('; ') || 'NONE');
  const counts: Record<string, number> = { priceHistory: 0, timelineItem: 0, transaction: 0, assignment: 0, maintenanceReport: 0, msrInvoice: 0, orderSource: 0 };
  for (let i = 0; i < ids.length; i += 5000) {
    const chunk = ids.slice(i, i + 5000);
    counts.priceHistory += await prisma.priceHistory.count({ where: { documentId: { in: chunk } } });
    counts.timelineItem += await prisma.timelineItem.count({ where: { documentId: { in: chunk } } });
    counts.transaction += await prisma.transaction.count({ where: { documentId: { in: chunk } } });
    counts.assignment += await prisma.assignment.count({ where: { documentId: { in: chunk } } });
    try { counts.maintenanceReport += await (prisma as any).maintenanceReport.count({ where: { OR: [{ documentId: { in: chunk } }, { invoiceId: { in: chunk } }] } }); } catch { try { counts.maintenanceReport += await (prisma as any).maintenanceReport.count({ where: { documentId: { in: chunk } } }); } catch { counts.maintenanceReport = -1; } }
    try { counts.msrInvoice = counts.msrInvoice + await (prisma as any).maintenanceReport.count({ where: { invoiceDocumentId: { in: chunk } } }); } catch { counts.msrInvoice = -1; }
    try { counts.orderSource += await (prisma as any).orderSource.count({ where: { documentId: { in: chunk } } }); } catch { counts.orderSource = -1; }
  }
  console.log('FK rows referencing target docs:', JSON.stringify(counts));
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
