import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: "BI202609001" } });
  const c: any = d!.config;
  const cust = await prisma.customer.findUnique({ where: { id: c.customerId }, select: { name: true, xeroId: true } });
  console.log(`${d!.name} [${d!.status}] date=${c.date} terms=${c.paymentTerms}`);
  console.log(`customer: ${cust?.name} · xeroId: ${cust?.xeroId ? "YES " + cust.xeroId.slice(0, 8) : "MISSING"}`);
  console.log(`totals: sub=${c.subTotal} gst=${c.gstAmount} nett=${c.nettTotal} · xeroInvoiceId=${c.xeroInvoiceId || "none (not pushed)"}`);
  console.log(`ref: ${String(c.reference || "").slice(0, 80)}`);
  for (const it of c.items || []) console.log(`  qty=${JSON.stringify(it.quantity)} up=${JSON.stringify(it.unitPrice)} amt=${JSON.stringify(it.amount)} acct=${it.accountCode || "—"} tax=${it.tax ?? "—"} :: ${String(it.description || "").split("\n")[0].slice(0, 55)}`);
  // range summary
  const all = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { gte: "BI202609001", lte: "BI202609093" } }, select: { name: true, status: true, config: true } });
  const series = all.filter(x => /^BI202609\d{3}$/.test(x.name!));
  const unconf = series.filter(x => ["draft", "unconfirmed"].includes(String(x.status)));
  const pushed = series.filter(x => (x.config as any)?.xeroInvoiceId);
  console.log(`\nrange 001–093: ${series.length} docs · ${unconf.length} unconfirmed · ${pushed.length} already have a Xero id`);
  process.exit(0);
})();
