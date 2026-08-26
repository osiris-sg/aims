// All templates: TERMS 30 DAYS (guru 2026-08-27).
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG } });
  for (const t of tpls) {
    const c: any = t.config;
    await prisma.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { config: { ...c, paymentTerms: "30 DAYS", documentInfo: { ...(c.documentInfo || {}), paymentTerms: "30 DAYS" } } } });
  }
  console.log(`stamped 30 DAYS terms on ${tpls.length} templates`);
  process.exit(0);
})();
