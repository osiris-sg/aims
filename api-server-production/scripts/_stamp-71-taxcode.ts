// F5 visibility for the 71 recurring drafts: doc-level taxCode '1' (standard-
// rated supplies) + gstAmount/subTotal into documentInfo where the GST report
// reads them. Their Xero copies are all TAX001 9%.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  let n = 0;
  for (const d of ours) {
    const c: any = d.config;
    const di: any = c.documentInfo || {};
    if (di.taxCode === "1" && di.gstAmount != null && di.subTotal != null) continue;
    await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, documentInfo: { ...di, taxCode: "1", gstAmount: c.gstAmount, subTotal: c.subTotal } } } });
    n++;
  }
  console.log(`stamped F5 tax fields on ${n}/${ours.length} drafts`);
  process.exit(0);
})();
