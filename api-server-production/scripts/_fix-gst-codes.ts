// Fix GST doc-coding drift (FY25/26 verify):
//  A) BILLs stamped taxCode '4' but ZERO gst → clear the code (no-tax bills
//     must not inflate F5 box 5; matches Xero's no-tax lines).
//  B) BILLs with real GST but NO taxCode → stamp '4' (standard-rated input).
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const DRY = process.argv.includes("--dry");
const R = (n: number) => Math.round(n * 100) / 100;
(async () => {
  // Xero truth: per-bill input-tax NET (any INPUT-family TaxType incl. zero-rated).
  const tokens = await getXeroTokens(null as any, ORG);
  const INPUTS = new Set(["TAX002", "INPUTY24", "INPUTY23", "INPUT", "ZERORATEDINPUT"]);
  const xeroNet = new Map<string, number>();
  const dt = (y: number, m: number, d2: number) => `DateTime(${y},${m},${d2})`;
  for (const [path, listKey, numKey, sign] of [["/Invoices", "Invoices", "InvoiceNumber", 1], ["/CreditNotes", "CreditNotes", "CreditNoteNumber", -1]] as any) {
    for (let page = 1; ; page++) {
      const r: any = await xeroGet(tokens, path, { where: `Date>=${dt(2021, 7, 1)}${path === "/Invoices" ? '&&Type=="ACCPAY"' : '&&Type=="ACCPAYCREDIT"'}`, page: String(page) });
      const rows = r[listKey] || [];
      for (const inv of rows) {
        if (["VOIDED", "DELETED"].includes(inv.Status)) continue;
        let net = 0;
        for (const l of inv.LineItems || []) if (INPUTS.has(l.TaxType)) net += Number(l.LineAmount) || 0;
        if (net) { const k = (inv[numKey] || "").trim(); xeroNet.set(k, R((xeroNet.get(k) || 0) + sign * net)); }
      }
      if (rows.length < 100) break;
    }
  }
  console.log(`xero input-net map: ${xeroNet.size} docs`);
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "BILL" }, select: { id: true, name: true, config: true } });
  let cleared = 0, stamped = 0;
  for (const d of docs) {
    const c: any = d.config;
    if (c.voided) continue;
    const di: any = c.documentInfo || {};
    const gst = Number(di.gstAmount ?? c.taxAmount ?? c.xeroTax ?? 0) || 0;
    const items: any[] = c.items || [];
    const hasTypedLines = items.some(it => it?.taxType);
    if (hasTypedLines) continue; // line-level path decides — doc-level code ignored
    const xnet = xeroNet.get((d.name || "").trim()) || 0;
    if (String(di.taxCode) === "4" && gst === 0 && xnet === 0) {
      cleared++;
      if (!DRY) await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, documentInfo: { ...di, taxCode: null } } } });
    } else if ((di.taxCode == null || di.taxCode === "") && gst > 0 && xnet > 0) {
      stamped++;
      if (!DRY) await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, documentInfo: { ...di, taxCode: "4" } } } });
      if (stamped <= 10) console.log(`  + ${d.name}: gst=${gst} → taxCode 4`);
    }
  }
  console.log(`${DRY ? "[DRY] " : ""}cleared taxCode on ${cleared} zero-GST bills; stamped '4' on ${stamped} GST-bearing uncoded bills`);
  process.exit(0);
})();
