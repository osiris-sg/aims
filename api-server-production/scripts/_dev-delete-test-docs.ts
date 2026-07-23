import { createScriptPrisma } from "./xero-migration/_common";
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const NAMES = ["BI2026070073", "BI2026070074", "BI2026070078", "CN202607-0001"];
(async () => {
  const prisma = createScriptPrisma();
  const docs = await prisma.document.findMany({
    where: { organizationId: ORG, name: { in: NAMES } },
    select: { id: true, name: true, type: true },
  });
  console.log(docs.map((d) => `${d.type} ${d.name}`).join(", "));
  const ids = docs.map((d) => d.id);
  // children / referencers first
  await prisma.documentItem.deleteMany({ where: { documentId: { in: ids } } });
  await prisma.documentEmbedding.deleteMany({ where: { documentId: { in: ids } } });
  await prisma.timelineItem.deleteMany({ where: { documentId: { in: ids } } });
  await prisma.deliveryShareLink.deleteMany({ where: { documentId: { in: ids } } }).catch(() => null);
  await prisma.payment.deleteMany({ where: { documentId: { in: ids } } }).catch(() => null);
  await prisma.document.updateMany({ where: { baseDocumentId: { in: ids } }, data: { baseDocumentId: null } });
  const r = await prisma.document.deleteMany({ where: { id: { in: ids } } });
  console.log(`deleted ${r.count} documents`);
  await prisma.$disconnect();
})();
