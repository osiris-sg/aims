import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { startsWith: "BI202609" } }, select: { name: true, createdAt: true }, orderBy: { name: "asc" } });
  const have = new Set(docs.map(d => d.name));
  const missing = [];
  for (let i = 1; i <= 89; i++) { const n = `BI202609${String(i).padStart(3, "0")}`; if (!have.has(n)) missing.push(n); }
  console.log("missing slots:", missing.join(", ") || "none");
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG, lastRunAt: null }, select: { code: true, name: true, nextRunDate: true } });
  console.log("templates never run:", tpls.map(t => `${t.code} (${t.name.slice(0, 40)}) next=${t.nextRunDate.toISOString().slice(0, 10)}`).join("; ") || "none");
  process.exit(0);
})();
