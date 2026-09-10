// Tenda +1 AIS (FIREFLY4200 AIS2026025, delivered 05/09): first invoice
// 5–30 Sep pro-rata + new 4th recurring chain @ $350/mth.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const R = (n: number) => Math.round(n * 100) / 100;
(async () => {
  const base = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, code: "REC-078" } });
  const bc: any = base!.config;
  const desc = "1. Rental of one unit of Advanced Illumination System\n\nModel: FIREFLY4200\nRated Power: 200W*4\nYear 2026\nS/No.: AIS2026025";
  const refBlock = "Location: 55 Sungei Kadut Loop Singapore 729498\n\nAttn: Joseph Lee\nMobile: 8972 9135";
  // ---- invoice: 5–30 Sep ----
  const name = "BI202609088";
  if (await prisma.document.findFirst({ where: { organizationId: ORG, name } })) { console.log("✗ number taken"); process.exit(1); }
  const net = R(350 * 26 / 30), gst = R(net * 0.09), gross = R(net + gst);
  const ref = `${name} (1st mth pro-rata 05-30/09 55 Sungei Kadut Loop - 1xAIS2026025)`;
  const doc = await prisma.document.create({ data: {
    organizationId: ORG, type: "INVOICE", name, status: "unconfirmed" as any, documentTemplateId: base!.documentTemplateId,
    config: {
      customerId: base!.customerId, customerName: "Tenda Equipment & Services Pte Ltd",
      date: "2026-09-05", currency: "SGD", taxApplicable: "Y", gstPercent: 9, billTo: bc.billTo,
      items: [
        { id: 1, description: "Rental period from 05/09/2026 to 30/09/2026 (1st mth, pro-rated 26/30 days)", quantity: null, unitPrice: null, amount: null },
        { id: 2, itemCode: "AIS", description: desc + "\nRate: $350.00/month × 26/30 days", quantity: 1, unitPrice: net, amount: net, accountCode: "227", tax: 9 },
        { id: 3, description: refBlock, quantity: null, unitPrice: null, amount: null },
      ],
      reference: ref, paymentTerms: "30 DAYS",
      subTotal: net, gstAmount: gst, nettTotal: gross,
      documentInfo: { documentNumber: name, date: "2026-09-05", referenceNo: ref, currency: "SGD", gstPercent: 9, paymentTerms: "30 DAYS", taxCode: "1", subTotal: net, gstAmount: gst },
      createdBy: "billing-catchup 2026-09-11 (tracker: Tenda AIS)",
    },
  } });
  console.log(`✓ ${name}: $${net} + $${gst} = $${gross} (05–30/09)`);
  // ---- recurring (4th Tenda chain) ----
  const tref = "BI{YEAR}{MONTH NO}999 (55 Sungei Kadut Loop {NTH} mth - 1xAIS2026025)";
  const tpl = await prisma.recurringInvoiceTemplate.create({ data: {
    organizationId: ORG, code: "REC-999", name: "Tenda Equipment & Services P — 1xAIS2026025 (added 05/09)",
    customerId: base!.customerId, documentTemplateId: base!.documentTemplateId,
    frequency: "MONTHLY", nextRunDate: new Date("2026-10-01T00:00:00+08:00"), nextRunNo: 2, autoSend: false, isActive: true,
    config: {
      items: [
        { id: 1, description: "Rental period from {MONTH START} to {MONTH END} ({NTH} mth)", quantity: null, unitPrice: null, amount: null },
        { id: 2, itemCode: "AIS", description: desc, quantity: 1, unitPrice: 350, amount: 350, accountCode: "227", tax: 9 },
        { id: 3, description: refBlock, quantity: null, unitPrice: null, amount: null },
      ],
      reference: tref, currency: "SGD", billTo: bc.billTo, paymentTerms: "30 DAYS", taxApplicable: "Y", gstPercent: 9,
      documentNumber: "BI{YEAR}{MONTH NO}999", subTotal: 350, gstAmount: 31.5, nettTotal: 381.5,
      documentInfo: { referenceNo: tref, currency: "SGD", gstPercent: 9, paymentTerms: "30 DAYS", taxCode: "1", subTotal: 350, gstAmount: 31.5 },
    },
    lastRunAt: new Date(), lastRunDocumentId: doc.id,
    createdBy: "billing-catchup 2026-09-11",
  } });
  console.log("✓ template created (provisional 999), linked to invoice");
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
