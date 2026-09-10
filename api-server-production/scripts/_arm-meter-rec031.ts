// Arm the Hock Lian Seng MBR-30 chain (REC-031 / draft BI202609031) with the
// metered-billing config (guru 2026-09-09): rate $10/m³, Aug closing 4,896.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const t = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, code: "REC-031" } });
  const tc: any = t!.config;
  // 1) meter state
  const meter = { site: "MBR 01 at Changi Coast Road", model: "MBR 30-capacity", serial: "M9B21070329503", unit: "m3", rate: 10, lastReading: 4896 };
  // 2) tokenize the template's meter line so every future generation rolls forward
  const items = (tc.items || []).map((it: any) => {
    const d = String(it.description || "");
    if (!/Meter Reading/i.test(d)) return it;
    const nd = d
      .replace(/Meter Readings as at [\d/]+ =\s*[\d,._]*\s*m3/i, "Meter Readings as at {MONTH END} =  {METER READING}m3")
      .replace(/(previous month accumulative readings of\s*)[\d,._]*\s*m3/i, "$1{PREV READING}m3");
    return { ...it, description: nd };
  });
  await prisma.recurringInvoiceTemplate.update({ where: { id: t!.id }, data: { config: { ...tc, meter, items, note: "METERED — use 'Enter meter reading' on the Recurring Invoices page after each month's generation" } } });
  console.log("✓ REC-031 armed: meter config + tokenized lines");
  // 3) pre-roll the September draft to awaiting-reading state
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: "BI202609031" } });
  const dc: any = d!.config;
  const dItems = (dc.items || []).map((it: any) => {
    const desc = String(it.description || "");
    if (!/Meter Reading/i.test(desc)) return it;
    const nd = desc
      .replace(/Meter Readings as at [\d/]+ =\s*[\d,._]*\s*m3/i, "Meter Readings as at 30/09/2026 =  ________m3")
      .replace(/(previous month accumulative readings of\s*)[\d,._]*\s*m3/i, "$1" + "4,896m3");
    return { ...it, description: nd, quantity: 0, unitPrice: 10, amount: 0 };
  });
  const lineAmount = (it: any) => parseFloat(it.amount) || (parseFloat(it.quantity) * parseFloat(it.unitPrice)) || 0;
  const net = +dItems.reduce((s: number, it: any) => s + lineAmount(it), 0).toFixed(2);
  const gst = +dItems.reduce((s: number, it: any) => s + lineAmount(it) * ((it.tax || 0) / 100), 0).toFixed(2);
  await prisma.document.update({ where: { id: d!.id }, data: { config: { ...dc, items: dItems, subTotal: net, gstAmount: gst, nettTotal: +(net + gst).toFixed(2), documentInfo: { ...(dc.documentInfo || {}), subTotal: net, gstAmount: gst } } } });
  console.log(`✓ BI202609031 pre-rolled: prev=4,896 · reading blank · totals $${(net + gst).toFixed(2)} until filled`);
  // 4) evidence check on the sister chain REC-032 (guru says only 031 is metered)
  const t32 = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, code: "REC-032" } });
  const has32 = /Meter Reading/i.test(JSON.stringify(t32!.config));
  console.log(`REC-032 (${t32!.name.slice(0, 40)}): meter-reading text present = ${has32}`);
  process.exit(0);
})();
