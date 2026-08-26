import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name: "DO202608-0019" }, select: { documentTemplateId: true, status: true, config: true } });
  const c: any = d!.config;
  console.log("tpl:", d!.documentTemplateId, "status:", d!.status);
  console.log("keys:", Object.keys(c).join(","));
  console.log("sample:", JSON.stringify({ date: c.date, customerName: c.customerName, deliveryTo: c.deliveryTo, items: (c.items || []).slice(0, 2) }).slice(0, 500));
  process.exit(0);
})();
