import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { gte: "BI202609001", lte: "BI202609099" } }, select: { name: true, config: true } });
  const series = docs.filter(d => /^BI202609\d{3}$/.test(d.name!));
  const pushed = series.filter(d => (d.config as any)?.xeroInvoiceId);
  const total = pushed.reduce((s, d) => s + (Number((d.config as any).nettTotal) || 0), 0);
  const missing = series.filter(d => !(d.config as any)?.xeroInvoiceId).map(d => d.name);
  console.log(`Sept series: ${series.length} invoices · ${pushed.length} now in Xero as DRAFT · total $${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  console.log(`not pushed: ${missing.join(", ") || "none"}`);
  process.exit(0);
})();
