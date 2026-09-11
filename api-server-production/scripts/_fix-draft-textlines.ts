// Re-blank annotation lines (period header, Qtn/DO/PO refs, location, remarks)
// on Sept drafts where an editor save coerced them to qty/0/0. Equipment
// lines (numbered "N)." with qty) keep the 1/0/0 convention.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const ANNOT = /^\s*(rental period\b|rental for the\b|\(?(our|your)\s+(do|qtn|po|ref|works|contract|sub-?contract|fi)\b|location\b|project\s*[:\/]|attn\b|remarks\b|mobile\b|\(quotation|rental of cables as follows:)/i;
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { gte: "BI202609001", lte: "BI202609099" } } });
  let fixed = 0, lines = 0;
  for (const d of docs) {
    if (!/^BI202609\d{3}$/.test(d.name!)) continue;
    const c: any = d.config;
    const xs = String(c.xeroStatus || "").toUpperCase();
    if (!["draft", "unconfirmed"].includes(String(d.status)) || ["AUTHORISED", "PAID"].includes(xs)) continue;
    let dirty = false;
    const items = (c.items || []).map((it: any) => {
      const desc = String(it.description || "").trim();
      const amt = Number(it.amount) || 0, up = Number(it.unitPrice) || 0;
      if (amt !== 0 || up !== 0) return it;
      if (!ANNOT.test(desc)) return it;
      if (it.quantity == null && it.unitPrice == null && it.amount == null) return it;
      dirty = true; lines++;
      return { ...it, quantity: null, unitPrice: null, amount: null, tax: null };
    });
    if (dirty) { fixed++; await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, items } } }); }
  }
  console.log(`re-blanked ${lines} lines across ${fixed} drafts`);
  process.exit(0);
})();
