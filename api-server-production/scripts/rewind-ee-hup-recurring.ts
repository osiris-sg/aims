import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const t = await p.recurringInvoiceTemplate.findFirst({ where: { name: 'Recurring — BI2026070003' } });
  if (!t) { console.log('template not found'); return; }
  console.log('before:', { nextRunDate: t.nextRunDate, autoSend: t.autoSend, projectId: t.projectId, projectDeploymentId: t.projectDeploymentId, sourceDocumentId: t.sourceDocumentId });
  const u = await p.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { nextRunDate: new Date('2026-07-07T00:00:00+08:00') } });
  console.log('nextRunDate rewound to', u.nextRunDate);
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
