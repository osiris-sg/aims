// Stamp taxCode '4' on unref'd JP bills whose Xero copy claims input GST —
// name-matching across the "(EMPLOYER)" suffix divergence.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const R = (n: number) => Math.round(n * 100) / 100;
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const INPUTS = new Set(["TAX002", "INPUTY24", "INPUTY23", "INPUT", "ZERORATEDINPUT"]);
  const xeroNet = new Map<string, number>();
  for (let page = 1; ; page++) {
    const r: any = await xeroGet(tokens, "/Invoices", { where: `Type=="ACCPAY"`, page: String(page) });
    const rows = r.Invoices || [];
    for (const inv of rows) {
      if (["VOIDED", "DELETED"].includes(inv.Status)) continue;
      let net = 0;
      for (const l of inv.LineItems || []) if (INPUTS.has(l.TaxType)) net += Number(l.LineAmount) || 0;
      if (net) {
        const full = (inv.InvoiceNumber || "").trim();
        const base = full.split(" (")[0].split(" ·")[0].trim();
        for (const k of new Set([full, base])) xeroNet.set(k, R((xeroNet.get(k) || 0) + net));
      }
    }
    if (rows.length < 100) break;
  }
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "BILL", name: { startsWith: "JP" } }, select: { id: true, name: true, config: true } });
  let stamped = 0;
  for (const d of docs) {
    const c: any = d.config;
    if (c.voided) continue;
    const di: any = c.documentInfo || {};
    if (di.taxCode) continue;
    if ((c.items || []).some((it: any) => it?.taxType)) continue;
    const base = (d.name || "").split(" (")[0].split(" ·")[0].trim();
    const xnet = xeroNet.get((d.name || "").trim()) || xeroNet.get(base) || 0;
    if (xnet <= 0) continue;
    await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, documentInfo: { ...di, taxCode: "4" } } } });
    stamped++;
  }
  console.log(`stamped taxCode 4 on ${stamped} JP bills with Xero input claims`);
  process.exit(0);
})();
