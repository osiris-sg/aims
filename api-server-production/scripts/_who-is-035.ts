import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const t = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG }, orderBy: { code: "asc" }, skip: 34 });
  console.log(`slot-035 template: ${t!.code} · ${t!.name} · lastRunDoc=${t!.lastRunDocumentId}`);
  if (t!.lastRunDocumentId) {
    const d = await prisma.document.findUnique({ where: { id: t!.lastRunDocumentId }, select: { name: true, createdAt: true, config: true } });
    console.log(`its generated doc: ${d?.name} created=${d?.createdAt.toISOString()}`);
  }
  process.exit(0);
})();
