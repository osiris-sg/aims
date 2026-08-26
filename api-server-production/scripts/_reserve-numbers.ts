// Stamp reserved number tokens on all templates: REC order → slot 001-089.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, orderBy: { code: "asc" } });
  let i = 0;
  for (const t of tpls) {
    i++;
    const slot = String(i).padStart(3, "0");
    const c: any = t.config;
    await prisma.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { config: { ...c, documentNumber: `BI{YEAR}{MONTH NO}${slot}` } } });
  }
  console.log(`reserved slots 001–${String(i).padStart(3, "0")} on ${i} templates (BI{YEAR}{MONTH NO}NNN)`);
  process.exit(0);
})();
