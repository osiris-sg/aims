// Prime Builders Aug catch-up: 20–31 Aug pro-rata @ $600/mth (PO 64 OD BI-PO-01).
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  // next free number in the August series (check AIMS + Xero)
  const aims = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { startsWith: "BI202608" } }, select: { name: true } });
  const used = new Set(aims.map(d => d.name));
  const tokens = await getXeroTokens(null as any, ORG);
  for (let page = 1; ; page++) {
    const r: any = await xeroGet(tokens, "/Invoices", { page: String(page), where: 'InvoiceNumber.StartsWith("BI202608")' } as any);
    for (const i of r.Invoices || []) used.add(i.InvoiceNumber);
    if ((r.Invoices || []).length < 100) break;
  }
  const nums = [...used].map(n => parseInt(String(n).replace("BI202608", ""), 10)).filter(n => isFinite(n) && n < 1000);
  const next = Math.max(...nums) + 1;
  const name = `BI202608${String(next).padStart(3, "0")}`;
  // basis: the Sept draft (format + billTo + customer link)
  const sept = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: "BI202609083" } });
  const sc: any = sept!.config;
  const net = 232.26, gst = 20.90, gross = 253.16;
  const ref = `${name} (1st mth pro-rata 20-31/08 - 64 Ocean Drive DO202608-017 1xAF5 009 · PO 64 OD BI-PO-01)`;
  const items = [
    { id: Date.now(), description: "Rental period from 20/08/2026 to 31/08/2026 (1st mth, pro-rated 12/31 days)", quantity: null, unitPrice: null, amount: null },
    { id: Date.now() + 1, itemCode: "AF5", description: "1). Rental of one unit Advance Filtration System\nModel: AF5 (5m3/hr)\nS/No.: AF5 009\nRate: $600.00/month × 12/31 days", quantity: 1, unitPrice: net, amount: net, accountCode: "201", tax: 9 },
    { id: Date.now() + 2, description: "Our DO No. DO202608-014 dated 21/08/2026", quantity: null, unitPrice: null, amount: null },
    { id: Date.now() + 3, description: "Your PO No. 64 OD BI-PO-01 dated 13/08/2026\n\nLocation:\n64 Ocean Drive Sentosa, Singapore 098200\n\nAttn: Mr Arvin Madrid\nMobile: 8056 9660", quantity: null, unitPrice: null, amount: null },
  ];
  await prisma.document.create({ data: {
    organizationId: ORG, type: "INVOICE", name, status: "unconfirmed" as any, documentTemplateId: sept!.documentTemplateId,
    config: {
      customerId: sc.customerId, customerName: "Prime Builders Pte Ltd",
      date: "2026-08-31", currency: "SGD", taxApplicable: "Y", gstPercent: 9,
      billTo: sc.billTo || "Prime Builders Pte Ltd\n1 Thomson Rd\n#03-336D\nSingapore 300001\nAttn: Accounts Dept.",
      items, reference: ref, paymentTerms: "30 DAYS",
      subTotal: net, gstAmount: gst, nettTotal: gross,
      documentInfo: { documentNumber: name, date: "2026-08-31", referenceNo: ref, currency: "SGD", gstPercent: 9, paymentTerms: "30 DAYS", taxCode: "1", subTotal: net, gstAmount: gst },
      createdBy: "billing-catchup 2026-09-11 (tracker row 4)",
    },
  } });
  console.log(`✓ created ${name} · Prime Builders · $${net} + $${gst} GST = $${gross} · dated 31/08/2026 (unconfirmed draft)`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
