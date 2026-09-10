// Tanglin LION500 (quote QO202608-0051, signed & chopped):
//  1) Aug catch-up: 25–31 Aug pro-rata + transport 2x$240
//  2) Sept draft BI202609086: $0 → $5,800 + GST
//  3) Template REC-086: rate in, ACTIVE
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const R = (n: number) => Math.round(n * 100) / 100;
(async () => {
  const sept = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: "BI202609086" } });
  const sc: any = sept!.config;
  const billTo = "TANGLIN CORPORATION PTE. LTD.\n217 Upper Bukit Timah Road\nSingapore 588185\nAttn: Accounts Dept.";
  // ---- 1) August catch-up ----
  const name = "BI202608132"; // next after Prime's 131
  const exists = await prisma.document.findFirst({ where: { organizationId: ORG, name } });
  if (exists) { console.log("✗ BI202608132 taken"); process.exit(1); }
  const unitAug = R(5800 * 7 / 31); // 1309.68
  const net = R(unitAug + 480), gst = R(net * 0.09), gross = R(net + gst);
  const ref = `${name} (1st mth pro-rata 25-31/08 - 18 Holland Drive DO202608-016 1xLION500 MG20260172 · Qtn QO202608-0051)`;
  await prisma.document.create({ data: {
    organizationId: ORG, type: "INVOICE", name, status: "unconfirmed" as any, documentTemplateId: sept!.documentTemplateId,
    config: {
      customerId: sc.customerId, customerName: "TANGLIN CORPORATION PTE. LTD.",
      date: "2026-08-31", currency: "SGD", taxApplicable: "Y", gstPercent: 9, billTo,
      items: [
        { id: 1, description: "Rental period from 25/08/2026 to 31/08/2026 (1st mth, pro-rated 7/31 days)", quantity: null, unitPrice: null, amount: null },
        { id: 2, itemCode: "LION500", description: "1). Rental of one unit Micro-Grid System\nBrand: BIOFUEL\nModel: LION500\nYear: 2026\nS/No.: MG20260172\nRate: $5,800.00/month × 7/31 days", quantity: 1, unitPrice: unitAug, amount: unitAug, accountCode: "214", tax: 9 },
        { id: 3, description: "2). Transport charges (delivery + collection)\nNote: waived if the rental period exceeds 3 months — to be credited if applicable", quantity: 2, unitPrice: 240, amount: 480, tax: 9 },
        { id: 4, description: "Our Qtn Ref. QO202608-0051 dated 26/08/2026\n\nOur DO No. DO202608-016 dated 25/08/2026\n\nLocation:\n18 Holland Drive (Woh Hup site)\n\nAttn: Kek Zhi Kai\nMobile: 8056 9259", quantity: null, unitPrice: null, amount: null },
      ],
      reference: ref, paymentTerms: "30 DAYS",
      subTotal: net, gstAmount: gst, nettTotal: gross,
      documentInfo: { documentNumber: name, date: "2026-08-31", referenceNo: ref, currency: "SGD", gstPercent: 9, paymentTerms: "30 DAYS", taxCode: "1", subTotal: net, gstAmount: gst },
      createdBy: "billing-catchup 2026-09-11 (tracker row 6)",
    },
  } });
  console.log(`✓ ${name} created: $${net} + $${gst} GST = $${gross} (incl transport $480 w/ waiver note)`);
  // ---- 2) fix Sept draft ----
  const items2 = (sc.items || []).map((it: any) => {
    if (/LION500|Micro-Grid/i.test(String(it.description || "")) && (Number(it.amount) || 0) === 0 && it.quantity != null) {
      return { ...it, itemCode: "LION500", description: "1). Rental of one unit Micro-Grid System\nBrand: BIOFUEL\nModel: LION500\nYear: 2026\nS/No.: MG20260172", quantity: 1, unitPrice: 5800, amount: 5800, accountCode: "214", tax: 9 };
    }
    return it;
  });
  const ref2 = `BI202609086 (2nd mth 18 Holland Drive - DO202608-016 1xLION500 MG20260172 · Qtn QO202608-0051)`;
  await prisma.document.update({ where: { id: sept!.id }, data: { config: { ...sc, items: items2, billTo, reference: ref2, subTotal: 5800, gstAmount: 522, nettTotal: 6322, note: "", documentInfo: { ...(sc.documentInfo || {}), referenceNo: ref2, subTotal: 5800, gstAmount: 522 } } } });
  console.log("✓ BI202609086 fixed: $5,800 + $522 = $6,322");
  // ---- 3) template ----
  const t = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, code: "REC-086" } });
  const tc: any = t!.config;
  const titems = (tc.items || []).map((it: any) => /LION500|Micro-Grid/i.test(String(it.description || "")) ? { ...it, itemCode: "LION500", description: "1). Rental of one unit Micro-Grid System\nBrand: BIOFUEL\nModel: LION500\nYear: 2026\nS/No.: MG20260172", quantity: 1, unitPrice: 5800, amount: 5800, accountCode: "214", tax: 9 } : it);
  const tref = String(tc.reference || "").replace(/1xLION500[^)]*/, "1xLION500 MG20260172 · Qtn QO202608-0051") ;
  await prisma.recurringInvoiceTemplate.update({ where: { id: t!.id }, data: { isActive: true, config: { ...tc, items: titems, reference: tref, billTo, subTotal: 5800, gstAmount: 522, nettTotal: 6322, note: "", documentInfo: { ...(tc.documentInfo || {}), referenceNo: tref, subTotal: 5800, gstAmount: 522 } } } });
  console.log(`✓ REC-086 activated @ $5,800/mth (next run ${t!.nextRunDate.toISOString().slice(0, 10)}, will be ${t!.nextRunNo}rd mth)`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
