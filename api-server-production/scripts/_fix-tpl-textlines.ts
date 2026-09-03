// Restore the AIMS line convention across all templates:
//  - annotation lines (period header, DO/Qtn/PO refs, location/attn, remarks,
//    cable headers): qty/unitPrice/amount/tax ALL null (blank on print)
//  - bundled equipment (numbered zero-amount component lines): qty (keep, else
//    1) / 0 / 0
//  - priced lines untouched; refill missing product codes from description.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const ANNOT = /^\s*(\d?\)?\.?\s*rental of cables as follows:|\(?(our|your)\s+(do|qtn|po|ref|works|contract|sub-?contract|fi)\b|location\b|project\s*[:\/]|attn\b|remarks\b|mobile\b|\(quotation|\d?\)?\.?\s*rental period\b|rental for the\b)/i;
function codeFromDesc(d: string): string | null {
  const lion = /LION\s?(\d+)/i.exec(d); if (lion) return `LION${lion[1]}`;
  const mbr = /MBR[-\s]?(\d+)/i.exec(d); if (mbr) return `MBR-${mbr[1]}`;
  const af = /\bAF[-\s]?(5|40|60|100)\b/i.exec(d); if (af) return `AF${af[1]}`;
  if (/DB\s*Box/i.test(d)) return "DBBOX";
  if (/holding\s*tank/i.test(d)) return "HOLDINGTANK";
  if (/SIDS/i.test(d)) return "SIDS";
  if (/\bAIS\b|solar/i.test(d)) return "AIS";
  if (/BESS|energy storage/i.test(d)) return "BESS";
  return null;
}
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG } });
  let fixed = 0, lines = 0;
  for (const t of tpls) {
    const c: any = t.config;
    let dirty = false;
    const items = (c.items || []).map((it: any) => {
      const amt = Number(it.amount) || 0, up = Number(it.unitPrice) || 0;
      const desc = (it.description || "").trim();
      if (amt !== 0 || up !== 0) {
        // priced line — refill product code if missing
        if (!it.itemCode) { const code = codeFromDesc(desc); if (code) { dirty = true; return { ...it, itemCode: code }; } }
        return it;
      }
      if (ANNOT.test(desc)) {
        if (it.quantity != null || it.unitPrice != null || it.amount != null || it.tax != null) { dirty = true; lines++; return { ...it, quantity: null, unitPrice: null, amount: null, tax: null }; }
        return it;
      }
      // bundled equipment
      const q = it.quantity == null || it.quantity === "" ? 1 : Number(it.quantity);
      if (it.quantity !== q || it.unitPrice !== 0 || it.amount !== 0) { dirty = true; lines++; return { ...it, quantity: q, unitPrice: 0, amount: 0, tax: 0 }; }
      return it;
    });
    if (dirty) { fixed++; await prisma.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { config: { ...c, items } } }); }
  }
  console.log(`fixed ${lines} lines across ${fixed} templates`);
  process.exit(0);
})();
