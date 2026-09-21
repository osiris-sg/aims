// The 4 Sept invoices whose GST was wiped to 0 by an editor save (taxApplicable
// stayed Y and every sibling month charges 9%): restore 9% GST on the lines and
// on the document totals.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const R = (n: number) => Math.round(n * 100) / 100;
(async () => {
  for (const n of ["BI202609025", "BI202609035", "BI202609069", "BI202609076"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: n } });
    const c: any = d!.config;
    const items = (c.items || []).map((it: any) => {
      const amt = Number(it.amount) || 0;
      if (amt === 0) return it;
      return { ...it, tax: 9, taxAmount: R(amt * 0.09) };
    });
    const sub = R(items.reduce((s: number, it: any) => s + (Number(it.amount) || 0), 0));
    const gst = R(sub * 0.09), nett = R(sub + gst);
    await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c, items, subTotal: sub, gstAmount: gst, nettTotal: nett,
      documentInfo: { ...(c.documentInfo || {}), taxCode: "1", gstPercent: 9, subTotal: sub, gstAmount: gst, currency: c.currency || "SGD", paymentTerms: c.paymentTerms || "30 DAYS", documentNumber: n, date: c.date, referenceNo: c.reference } } } });
    console.log(`✓ ${n}: ${sub} + ${gst} GST = ${nett} (was nett ${c.nettTotal} with no GST)`);
  }
  process.exit(0);
})();
