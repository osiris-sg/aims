// Drill: per-document code-4/5/9/11 net using the VERIFIER's exact AIMS logic
// vs Xero per-invoice input-tax lines. FY25/26.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const R = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const FROM = new Date("2025-07-01T00:00:00.000Z"), TO = new Date("2026-06-30T23:59:59.999Z");
const MAP: Record<string, { code: string; side: "OUTPUT" | "INPUT" }> = {
  TAX001: { code: "1", side: "OUTPUT" }, OUTPUTY24: { code: "1", side: "OUTPUT" },
  OUTPUTY23: { code: "8", side: "OUTPUT" }, OUTPUT: { code: "10", side: "OUTPUT" },
  TAX002: { code: "4", side: "INPUT" }, INPUTY24: { code: "4", side: "INPUT" },
  INPUTY23: { code: "9", side: "INPUT" }, INPUT: { code: "11", side: "INPUT" },
  ZERORATEDOUTPUT: { code: "2", side: "OUTPUT" }, ZERORATEDINPUT: { code: "5", side: "INPUT" },
  OSOUTPUT: { code: "13", side: "OUTPUT" }, OPINPUT: { code: "12", side: "INPUT" },
};
const PURCHASE_CODES = new Set(["4", "5", "7", "9", "11"]);
(async () => {
  // ---- AIMS per-doc (verifier logic verbatim)
  const [docs, taxRates] = await Promise.all([
    prisma.document.findMany({ where: { organizationId: ORG, type: { in: ["INVOICE", "TI", "TI2", "BILL", "CREDIT_NOTE", "DEBIT_NOTE", "PURCHASE_RETURN"] } }, select: { name: true, type: true, status: true, createdAt: true, config: true } }),
    prisma.taxRate.findMany({ where: { organizationId: ORG } }),
  ]);
  const rateByCode = new Map(taxRates.map((t: any) => [t.code, t]));
  const aims = new Map<string, number>();
  for (const doc of docs) {
    const c: any = doc.config || {};
    if (c.voided) continue;
    const status = (doc.status || "").toLowerCase();
    if (status === "draft" || status === "cancelled") continue;
    const di: any = c.documentInfo || {};
    const date = c.date ? new Date(c.date) : c.billDate ? new Date(c.billDate) : doc.createdAt;
    if (date < FROM || date > TO) continue;
    const signFor = (side: string) => side === "OUTPUT" ? (doc.type === "CREDIT_NOTE" ? 1 : -1) : (doc.type === "CREDIT_NOTE" || doc.type === "PURCHASE_RETURN" ? -1 : 1);
    const items: any[] = Array.isArray(c.items) ? c.items : [];
    const typed = items.filter((it) => it?.taxType && MAP[String(it.taxType)]);
    const key = (doc.name || "").trim();
    if (typed.length) {
      for (const it of typed) {
        const m = MAP[String(it.taxType)];
        if (m.side !== "INPUT" || !PURCHASE_CODES.has(m.code)) continue;
        aims.set(key, R((aims.get(key) || 0) + (Number(it.amount) || 0) * signFor(m.side)));
      }
      continue;
    }
    const code = di.taxCode != null && di.taxCode !== "" ? String(di.taxCode) : null;
    if (!code || !PURCHASE_CODES.has(code)) continue;
    const tr: any = rateByCode.get(code);
    const side = (tr?.direction as any) || (doc.type === "BILL" || doc.type === "PURCHASE_RETURN" ? "INPUT" : "OUTPUT");
    if (side !== "INPUT") continue;
    const tax = R(Number(di.gstAmount ?? c.taxAmount ?? c.xeroTax ?? 0) || 0);
    let net = Number(di.subTotal ?? c.subtotal ?? c.subTotal ?? NaN);
    if (!Number.isFinite(net)) { const gross = Number(c.xeroGross ?? di.nettTotal ?? c.nettTotal ?? c.totalAmount ?? 0) || 0; net = R(gross - tax); } else net = R(net);
    aims.set(key, R((aims.get(key) || 0) + net * signFor(side)));
  }
  // ---- Xero per-invoice input net (lines)
  const tokens = await getXeroTokens(null as any, ORG);
  const dt = (d: Date) => `DateTime(${d.getUTCFullYear()},${d.getUTCMonth() + 1},${d.getUTCDate()})`;
  const INPUTS = new Set(["TAX002", "INPUTY24", "INPUTY23", "INPUT", "ZERORATEDINPUT"]);
  const xero = new Map<string, number>();
  for (const [path, listKey, numKey, sign] of [["/Invoices", "Invoices", "InvoiceNumber", 1], ["/CreditNotes", "CreditNotes", "CreditNoteNumber", -1]] as any) {
    for (let page = 1; ; page++) {
      const r: any = await xeroGet(tokens, path, { where: `Date>=${dt(FROM)}&&Date<=${dt(TO)}${path === "/Invoices" ? '&&Type=="ACCPAY"' : '&&Type=="ACCPAYCREDIT"'}`, page: String(page) });
      const rows = r[listKey] || [];
      for (const inv of rows) {
        if (["VOIDED", "DELETED", "DRAFT", "SUBMITTED"].includes(inv.Status)) continue;
        let net = 0;
        for (const l of inv.LineItems || []) if (INPUTS.has(l.TaxType)) net += Number(l.LineAmount) || 0;
        if (net) { const k = (inv[numKey] || "").trim(); xero.set(k, R((xero.get(k) || 0) + sign * net)); }
      }
      if (rows.length < 100) break;
    }
  }
  const keys = new Set([...aims.keys(), ...xero.keys()]);
  const diffs: any[] = [];
  for (const k of keys) {
    const a = aims.get(k) || 0, x = xero.get(k) || 0;
    if (Math.abs(a - x) > 0.01) diffs.push({ k, a, x, d: R(a - x) });
  }
  diffs.sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
  console.log(`${diffs.length} docs differ on purchase net; top 20:`);
  for (const d of diffs.slice(0, 20)) console.log(`  ${d.k.padEnd(34)} Δ ${String(d.d).padStart(11)}  (aims ${d.a} vs xero ${d.x})`);
  console.log("Σ Δ:", R(diffs.reduce((s, d) => s + d.d, 0)));
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
