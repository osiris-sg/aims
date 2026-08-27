// READ-ONLY: resolve a view-only DO share token to its document + proof reports.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const token = process.argv[2];
  const link = await prisma.documentShareLink.findUnique({
    where: { token },
    select: { documentId: true, revokedAt: true, document: { select: { id: true, name: true, type: true, organizationId: true, config: true } } },
  });
  if (!link) { console.log('NO LINK'); return; }
  const cfg: any = link.document.config || {};
  console.log(JSON.stringify({
    doc: link.document.id, name: link.document.name, type: link.document.type, org: link.document.organizationId, revoked: link.revokedAt,
    items: (cfg.items || []).map((i: any) => ({ id: i.id, desc: i.description, deliveryItemId: i.deliveryItemId, inventoryItemId: i.inventoryItemId, serials: i.serialNumbers })),
  }, null, 2));
  const reports = await prisma.maintenanceServiceReport.findMany({
    where: { documentId: link.document.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, kind: true, photos: true, inventoryId: true, deliveryItemId: true, description: true, createdAt: true },
  });
  console.log(JSON.stringify(reports, null, 2));
  await prisma.$disconnect();
})();
