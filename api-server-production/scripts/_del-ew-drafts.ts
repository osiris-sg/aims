import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  for (const name of ["BIPL-EW-INV-20260909-0056", "BIPL-EW-INV-20260909-0057"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name } });
    if (!d) { console.log(`= ${name} not found`); continue; }
    const c: any = d.config;
    if (!["draft", "unconfirmed"].includes(String(d.status)) || c.xeroInvoiceId) { console.log(`⚠ ${name} not a plain draft — skipped`); continue; }
    await prisma.document.delete({ where: { id: d.id } });
    console.log(`✓ deleted ${name} (unconfirmed draft, $4,800 line unverified)`);
  }
  process.exit(0);
})();
