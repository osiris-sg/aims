import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG } });
  const t = tpls.find(x => JSON.stringify(x.config).includes("MG20250110"));
  console.log(`${t!.code} · ${t!.name}`);
  for (const it of ((t!.config as any).items || [])) console.log(` qty=${JSON.stringify(it.quantity)} up=${JSON.stringify(it.unitPrice)} amt=${JSON.stringify(it.amount)} :: ${(it.description || "").replace(/\n/g, " ¶ ").slice(0, 60)}`);
  process.exit(0);
})();
