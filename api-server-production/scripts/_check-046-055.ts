import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  for (const name of ["BI202608046", "BI202608055"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name, config: { path: ["xeroSyncedBy"], equals: "app2-recurring-push" } }, select: { config: true } });
    const c: any = d!.config;
    const r: any = await xeroGet(tokens, "/Invoices", { IDs: c.xeroInvoiceId } as any);
    const inv = r.Invoices?.[0];
    console.log(`${name}: xeroId=${c.xeroInvoiceId.slice(0, 8)} → ${inv ? `[${inv.Status}] $${inv.Total} num=${inv.InvoiceNumber}` : "NOT FOUND"}`);
  }
  process.exit(0);
})();
