// Restore line-level tax% + F5 documentInfo on the Sept series (lost when docs
// were opened/saved in the editor — the invoice layout hides the tax column).
// Principled: only when the doc's own gstAmount proves a flat 9% on subTotal.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const APPLY = process.argv.includes("--apply");
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { gte: "BI202609001", lte: "BI202609099" } } });
  let fixed = 0, ok = 0, skipped: string[] = [];
  for (const d of docs) {
    if (!/^BI202609\d{3}$/.test(d.name!)) continue;
    const c: any = d.config;
    const items: any[] = c.items || [];
    const priced = items.filter(i => (Number(i.amount) || 0) !== 0);
    if (!priced.length) continue;
    const sub = Number(c.subTotal) || priced.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const gst = Number(c.gstAmount) || 0;
    const needsLineTax = priced.some(i => (Number(i.tax) || 0) === 0);
    const needsDocInfo = !c.documentInfo?.taxCode || c.documentInfo?.gstAmount == null;
    if (!needsLineTax && !needsDocInfo) { ok++; continue; }
    // only touch when GST is exactly 9% of subtotal (no mixed/zero-rated cases)
    if (gst <= 0 || Math.abs(gst - Math.round(sub * 9) / 100) > 0.02) { skipped.push(`${d.name} (gst ${gst} vs 9% of ${sub})`); continue; }
    const newItems = items.map(it => {
      const amt = Number(it.amount) || 0;
      if (amt === 0) return it;                       // bundled/annotation lines untouched
      if ((Number(it.tax) || 0) > 0) return it;
      return { ...it, tax: 9, taxAmount: Math.round(amt * 9) / 100 };
    });
    const documentInfo = { ...(c.documentInfo || {}), taxCode: "1", gstPercent: 9, subTotal: sub, gstAmount: gst, currency: c.currency || "SGD", paymentTerms: c.documentInfo?.paymentTerms || c.paymentTerms || "30 DAYS", documentNumber: c.documentInfo?.documentNumber || d.name, date: c.documentInfo?.date || c.date, referenceNo: c.documentInfo?.referenceNo || c.reference };
    fixed++;
    console.log(`${APPLY ? "FIX " : "would "}${d.name}: ${needsLineTax ? "lines+" : ""}${needsDocInfo ? "docInfo" : ""} (sub ${sub} gst ${gst})`);
    if (APPLY) await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, items: newItems, documentInfo } } });
  }
  console.log(`\n${APPLY ? "fixed" : "would fix"} ${fixed} · already good ${ok} · skipped ${skipped.length}`);
  for (const s of skipped) console.log("  ⚠ skip", s);
  process.exit(0);
})();
