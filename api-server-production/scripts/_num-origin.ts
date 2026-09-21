import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  for (const n of ["BI2026090206", "BI2026090205", "BI202609204"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, name: n }, select: { name: true, type: true, createdAt: true, config: true } });
    if (!d) { console.log(`${n}: not found`); continue; }
    const c: any = d.config;
    console.log(`${n} [${d.type}] created=${d.createdAt.toISOString().slice(11, 16)} numberFormatId=${c.numberFormatId ? String(c.numberFormatId).slice(0, 8) : "NONE"} createdBy=${c.createdBy || "?"} src=${c.sourceDocumentNumber || "—"}`);
  }
  // what do the other auto-created invoices look like this month?
  const recent = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-09-20") } }, select: { name: true, createdAt: true, config: true }, orderBy: { createdAt: "asc" } });
  console.log("\ninvoices created since 20 Sep:");
  for (const d of recent) {
    const c: any = d.config;
    console.log(`  ${d.name!.padEnd(14)} ${d.createdAt.toISOString().slice(5, 16)} fmt=${c.numberFormatId ? String(c.numberFormatId).slice(0, 8) : "none"} src=${c.sourceDocumentNumber || "—"}`);
  }
  process.exit(0);
})();
