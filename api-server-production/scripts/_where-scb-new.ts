import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const t = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, name: { contains: "ID No. 063" } } });
  console.log(`${t!.code} · ${t!.name.slice(0, 60)} · active=${t!.isActive} · slot token=${(t!.config as any).documentNumber}`);
  process.exit(0);
})();
