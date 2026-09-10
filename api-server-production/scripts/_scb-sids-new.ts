// New SCB SIDS chain (SID 063 + solar, Blk 366 Yishun Ring Rd, delivered 31/08
// per their DO202608-016): recurring template + first invoice 31/08–30/09.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const R = (n: number) => Math.round(n * 100) / 100;
(async () => {
  const base = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, code: "REC-067" } });
  const bc: any = base!.config;
  const desc = "1a). Rental of one set SIDS System complete with the following:\n\n1b). Solar Panel\n1c). Web Access including SIM Card\n1d). TSS Sensor\n\nID No. 063";
  const refsBlock = "Our Qtn Ref. BI/EL/2025-0711 (Rev 1)\ndated 04/08/2025\n\nOur DO No. DO202608-016 dated 31/08/2026\n\nLocation:\nBlk 366, Yishun Ring Road\n\nAttention:\nMs Nisha - 8732 0033";
  const poBlock = "Your PO No. SCB-PO-2608-16847 dated 19/08/2026";
  const items = [
    { id: 1, description: "1). Rental period from {MONTH START} to {MONTH END} - {NTH} mth", quantity: null, unitPrice: null, amount: null },
    { id: 2, itemCode: "SIDS", description: desc, quantity: 1, unitPrice: 500, amount: 500, accountCode: "220", tax: 9 },
    { id: 3, description: refsBlock, quantity: null, unitPrice: null, amount: null },
    { id: 4, description: poBlock, quantity: null, unitPrice: null, amount: null },
  ];
  const tref = "BI{YEAR}{MONTH NO}999 ({NTH} mth Blk 366 Yishun Ring Rd DO202608-016 1xSIDS ID No. 063)";
  const tpl = await prisma.recurringInvoiceTemplate.create({ data: {
    organizationId: ORG, code: "REC-999", name: "SCB Building Construction Pt — DO202608-016 1xSIDS ID No. 063 (Yishun Blk 366)",
    customerId: base!.customerId, documentTemplateId: base!.documentTemplateId,
    frequency: "MONTHLY", nextRunDate: new Date("2026-10-01T00:00:00+08:00"), nextRunNo: 2, autoSend: false, isActive: true,
    config: { items, reference: tref, currency: "SGD", billTo: bc.billTo, paymentTerms: "30 DAYS", taxApplicable: "Y", gstPercent: 9,
      documentNumber: "BI{YEAR}{MONTH NO}999", subTotal: 500, gstAmount: 45, nettTotal: 545,
      documentInfo: { referenceNo: tref, currency: "SGD", gstPercent: 9, paymentTerms: "30 DAYS", taxCode: "1", subTotal: 500, gstAmount: 45 } },
    createdBy: "billing-catchup 2026-09-11 (tracker row 7)",
  } });
  console.log("✓ template created (provisional slot 999)");
  // first invoice: 31/08 – 30/09 (1st mth + the one Aug day)
  const name = "BI202609087";
  const taken = await prisma.document.findFirst({ where: { organizationId: ORG, name } });
  if (taken) { console.log("✗ BI202609087 taken"); process.exit(1); }
  const net = R(500 + 500 / 31), gst = R(net * 0.09), gross = R(net + gst);
  const ref = `${name} (1st mth 31/08-30/09 Blk 366 Yishun Ring Rd DO202608-016 1xSIDS ID No. 063)`;
  const doc = await prisma.document.create({ data: {
    organizationId: ORG, type: "INVOICE", name, status: "unconfirmed" as any, documentTemplateId: base!.documentTemplateId,
    config: {
      customerId: base!.customerId, customerName: "SCB Building Construction Pte Ltd",
      date: "2026-09-01", currency: "SGD", taxApplicable: "Y", gstPercent: 9, billTo: bc.billTo,
      items: [
        { id: 1, description: "1). Rental period from 31/08/2026 to 30/09/2026 - 1st mth (incl. 1 day Aug pro-rata)", quantity: null, unitPrice: null, amount: null },
        { id: 2, itemCode: "SIDS", description: desc + "\nRate: $500.00/month (+ 31/08 pro-rata $16.13)", quantity: 1, unitPrice: net, amount: net, accountCode: "220", tax: 9 },
        { id: 3, description: refsBlock, quantity: null, unitPrice: null, amount: null },
        { id: 4, description: poBlock, quantity: null, unitPrice: null, amount: null },
      ],
      reference: ref, paymentTerms: "30 DAYS",
      subTotal: net, gstAmount: gst, nettTotal: gross,
      documentInfo: { documentNumber: name, date: "2026-09-01", referenceNo: ref, currency: "SGD", gstPercent: 9, paymentTerms: "30 DAYS", taxCode: "1", subTotal: net, gstAmount: gst },
      createdBy: "billing-catchup 2026-09-11 (tracker row 7)",
    },
  } });
  await prisma.recurringInvoiceTemplate.update({ where: { id: tpl.id }, data: { lastRunAt: new Date(), lastRunDocumentId: doc.id } });
  console.log(`✓ ${name} created: $${net} + $${gst} = $${gross} (31/08–30/09) · linked to template`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
