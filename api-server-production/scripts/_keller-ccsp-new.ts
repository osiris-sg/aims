// Two new chains from found POs (guru 2026-09-11):
//  A) Keller — LION250 BESS MG20260162 + 60kVA genset @ $4,600/mth + transport
//     (PO K1930290PO DRAFT, Qtn QO202609-0056, Pulau Sudong via Kim Heng yard)
//  B) CCSP — AF60 0018 ECM $1,800 + TSS/SIDS SID058 $450 @ 44 Faber Walk
//     (PO FWC/00113, 13-month term)
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const R = (n: number) => Math.round(n * 100) / 100;
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG } });
  const keller = tpls.find(t => /Keller/i.test(t.name))!;
  const ccsp = tpls.find(t => /Canberra/i.test(JSON.stringify(t.config)) && /China Construction/i.test(t.name))
    || tpls.find(t => /South Pacific/i.test(t.name));
  const kbc: any = keller.config, cbc: any = ccsp!.config;

  // ── A) KELLER ──
  const kDesc = "1). Rental of one set BESS LION250 c/w 60KVA genset, autostart & switch\nModel: LION250 (250kW, 50Hz, 360A)\nS/No.: MG20260162\n2-shift · for min 200kVA supply";
  const kRefs = "Our Qtn Ref. QO202609-0056\n\nYour PO No. K1930290PO dated 01/09/2026 (DRAFT — final PO to follow)\nProject: KSIG2508, Pulau Sudong\n\nDelivery Location:\nKim Heng Limited, 48 Penjuru Rd\nContact: Mani 8281 2564";
  const kNet = R(4600 * 27 / 30) + 360, kGst = R(kNet * 0.09), kGross = R(kNet + kGst);
  const kName = "BI202609089";
  const kRef = `${kName} (1st mth pro-rata 04-30/09 + transport - KSIG2508 Pulau Sudong 1xLION250 MG20260162 · PO K1930290PO)`;
  const kDoc = await prisma.document.create({ data: {
    organizationId: ORG, type: "INVOICE", name: kName, status: "unconfirmed" as any, documentTemplateId: keller.documentTemplateId,
    config: { customerId: keller.customerId, customerName: "Keller Foundations (S E Asia) Pte Ltd",
      date: "2026-09-04", currency: "SGD", taxApplicable: "Y", gstPercent: 9, billTo: kbc.billTo,
      items: [
        { id: 1, description: "Rental period from 04/09/2026 to 30/09/2026 (1st mth, pro-rated 27/30 days)", quantity: null, unitPrice: null, amount: null },
        { id: 2, itemCode: "LION250", description: kDesc + "\nRate: $4,600.00/month × 27/30 days", quantity: 1, unitPrice: R(4600 * 27 / 30), amount: R(4600 * 27 / 30), accountCode: "214", tax: 9 },
        { id: 3, description: "2). Transport charge $180/way", quantity: 2, unitPrice: 180, amount: 360, tax: 9 },
        { id: 4, description: kRefs, quantity: null, unitPrice: null, amount: null },
      ],
      reference: kRef, paymentTerms: "30 DAYS", subTotal: kNet, gstAmount: kGst, nettTotal: kGross,
      documentInfo: { documentNumber: kName, date: "2026-09-04", referenceNo: kRef, currency: "SGD", gstPercent: 9, paymentTerms: "30 DAYS", taxCode: "1", subTotal: kNet, gstAmount: kGst },
      createdBy: "billing-catchup 2026-09-11 (Keller Sudong)" } } });
  const kTref = "BI{YEAR}{MONTH NO}999 ({NTH} mth KSIG2508 Pulau Sudong - 1xLION250 MG20260162 · PO K1930290PO)";
  await prisma.recurringInvoiceTemplate.create({ data: {
    organizationId: ORG, code: "REC-998", name: "Keller Foundations — KSIG2508 Pulau Sudong 1xLION250 MG20260162",
    customerId: keller.customerId, documentTemplateId: keller.documentTemplateId,
    frequency: "MONTHLY", nextRunDate: new Date("2026-10-01T00:00:00+08:00"), nextRunNo: 2, autoSend: false, isActive: true,
    config: { items: [
        { id: 1, description: "Rental period from {MONTH START} to {MONTH END} - {NTH} mth", quantity: null, unitPrice: null, amount: null },
        { id: 2, itemCode: "LION250", description: kDesc, quantity: 1, unitPrice: 4600, amount: 4600, accountCode: "214", tax: 9 },
        { id: 3, description: kRefs, quantity: null, unitPrice: null, amount: null },
      ], reference: kTref, currency: "SGD", billTo: kbc.billTo, paymentTerms: "30 DAYS", taxApplicable: "Y", gstPercent: 9,
      documentNumber: "BI{YEAR}{MONTH NO}999", subTotal: 4600, gstAmount: 414, nettTotal: 5014,
      documentInfo: { referenceNo: kTref, currency: "SGD", gstPercent: 9, paymentTerms: "30 DAYS", taxCode: "1", subTotal: 4600, gstAmount: 414 } },
    lastRunAt: new Date(), lastRunDocumentId: kDoc.id, createdBy: "billing-catchup 2026-09-11" } });
  console.log(`✓ Keller: ${kName} $${kGross} + template @ $4,600/mth`);

  // ── B) CCSP Faber Walk ──
  const cName = "BI202609090";
  const cNet = R(2250 * 24 / 30), cGst = R(cNet * 0.09), cGross = R(cNet + cGst);
  const cBillTo = "China Construction (South Pacific) Development Co Pte Ltd\n182 Cecil Street, #31-01\nFrasers Tower\nSingapore 069547\nAttn: Accounts Dept.";
  const cDesc1 = "1). Rental of one unit ECM — Advanced Filtration System\nModel: AF60\nS/No.: AF 60 0018";
  const cDesc2 = "2). Rental of one set TSS System (SIDS)\nModel: SIDS\nS/No.: SID 058";
  const cRefs = "Your PO No. FWC/00113 dated 01/09/2026 (Ref RF/FWC/QS/071 · 13-month rental)\n\nLocation:\n44 Faber Walk\n\nSite Contact: Velu Mariappan 8133 8449";
  const cRef = `${cName} (1st mth pro-rata 07-30/09 44 Faber Walk - 1xAF60 0018 & 1xSIDS SID058 · PO FWC/00113)`;
  const cDoc = await prisma.document.create({ data: {
    organizationId: ORG, type: "INVOICE", name: cName, status: "unconfirmed" as any, documentTemplateId: ccsp!.documentTemplateId,
    config: { customerId: ccsp!.customerId, customerName: "China Construction (South Pacific) Development Co Pte Ltd",
      date: "2026-09-07", currency: "SGD", taxApplicable: "Y", gstPercent: 9, billTo: cBillTo,
      items: [
        { id: 1, description: "Rental period from 07/09/2026 to 30/09/2026 (1st mth, pro-rated 24/30 days)", quantity: null, unitPrice: null, amount: null },
        { id: 2, itemCode: "AF60", description: cDesc1 + "\nRate: $1,800.00/month × 24/30 days", quantity: 1, unitPrice: R(1800 * 24 / 30), amount: R(1800 * 24 / 30), accountCode: "201", tax: 9 },
        { id: 3, itemCode: "SIDS", description: cDesc2 + "\nRate: $450.00/month × 24/30 days", quantity: 1, unitPrice: R(450 * 24 / 30), amount: R(450 * 24 / 30), accountCode: "220", tax: 9 },
        { id: 4, description: cRefs, quantity: null, unitPrice: null, amount: null },
      ],
      reference: cRef, paymentTerms: "30 DAYS", subTotal: cNet, gstAmount: cGst, nettTotal: cGross,
      documentInfo: { documentNumber: cName, date: "2026-09-07", referenceNo: cRef, currency: "SGD", gstPercent: 9, paymentTerms: "30 DAYS", taxCode: "1", subTotal: cNet, gstAmount: cGst },
      createdBy: "billing-catchup 2026-09-11 (CCSP Faber Walk)" } } });
  const cTref = "BI{YEAR}{MONTH NO}999 ({NTH} mth 44 Faber Walk - 1xAF60 0018 & 1xSIDS SID058 · PO FWC/00113)";
  await prisma.recurringInvoiceTemplate.create({ data: {
    organizationId: ORG, code: "REC-997", name: "China Construction (South Pac — 44 Faber Walk AF60 0018 + SIDS SID058",
    customerId: ccsp!.customerId, documentTemplateId: ccsp!.documentTemplateId,
    frequency: "MONTHLY", nextRunDate: new Date("2026-10-01T00:00:00+08:00"), nextRunNo: 2, autoSend: false, isActive: true,
    config: { items: [
        { id: 1, description: "Rental period from {MONTH START} to {MONTH END} - {NTH} mth", quantity: null, unitPrice: null, amount: null },
        { id: 2, itemCode: "AF60", description: cDesc1, quantity: 1, unitPrice: 1800, amount: 1800, accountCode: "201", tax: 9 },
        { id: 3, itemCode: "SIDS", description: cDesc2, quantity: 1, unitPrice: 450, amount: 450, accountCode: "220", tax: 9 },
        { id: 4, description: cRefs, quantity: null, unitPrice: null, amount: null },
      ], reference: cTref, currency: "SGD", billTo: cBillTo, paymentTerms: "30 DAYS", taxApplicable: "Y", gstPercent: 9,
      documentNumber: "BI{YEAR}{MONTH NO}999", subTotal: 2250, gstAmount: 202.5, nettTotal: 2452.5,
      documentInfo: { referenceNo: cTref, currency: "SGD", gstPercent: 9, paymentTerms: "30 DAYS", taxCode: "1", subTotal: 2250, gstAmount: 202.5 } },
    lastRunAt: new Date(), lastRunDocumentId: cDoc.id, createdBy: "billing-catchup 2026-09-11" } });
  console.log(`✓ CCSP: ${cName} $${cGross} + template @ $2,250/mth`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
