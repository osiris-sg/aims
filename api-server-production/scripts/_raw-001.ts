import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: "BI202609001" } });
  const c: any = d!.config;
  for (const it of c.items || []) console.log(JSON.stringify({ q: it.quantity, up: it.unitPrice, amt: it.amount, acct: it.accountCode, tax: it.tax, taxAmount: it.taxAmount, itemCode: it.itemCode, d: String(it.description || "").split("\n")[0].slice(0, 30) }));
  console.log("\ndocumentInfo:", JSON.stringify({ taxCode: c.documentInfo?.taxCode, gstPercent: c.documentInfo?.gstPercent, terms: c.documentInfo?.paymentTerms, sub: c.documentInfo?.subTotal, gst: c.documentInfo?.gstAmount }));
  console.log("taxApplicable:", c.taxApplicable, "· gstPercent:", c.gstPercent);
  // how many Sept docs have tax on priced lines?
  const all = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { gte: "BI202609001", lte: "BI202609093" } }, select: { name: true, config: true } });
  let withTax = 0, without = 0;
  for (const x of all) {
    if (!/^BI202609\d{3}$/.test(x.name!)) continue;
    const items: any[] = (x.config as any).items || [];
    const priced = items.filter(i => (Number(i.amount) || 0) !== 0);
    if (!priced.length) continue;
    if (priced.some(i => (Number(i.tax) || 0) > 0)) withTax++; else without++;
  }
  console.log(`\nSept series: ${withTax} docs have line-level tax, ${without} do NOT`);
  process.exit(0);
})();
