// Per-document drill-down of the box5/box7 drift: AIMS doc-level code-4 vs
// Xero line-level TAX002/INPUT* per invoice number, FY25/26.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const R = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const FROM = new Date("2025-07-01T00:00:00Z"), TO = new Date("2026-06-30T23:59:59Z");
const INPUT_TYPES = new Set(["TAX002", "INPUTY24", "INPUTY23", "INPUT"]);
const dnet = (s: string) => { const m = /\/Date\((\d+)/.exec(s || ""); return m ? new Date(Number(m[1])) : new Date(s); };
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  // Xero: ACCPAY invoices + ACCPAY credit notes with input-tax lines
  const xero = new Map<string, { net: number; tax: number }>();
  const dt = (d: Date) => `DateTime(${d.getUTCFullYear()},${d.getUTCMonth() + 1},${d.getUTCDate()})`;
  for (const [path, listKey, numKey, sign] of [["/Invoices", "Invoices", "InvoiceNumber", 1], ["/CreditNotes", "CreditNotes", "CreditNoteNumber", -1]] as any) {
    for (let page = 1; ; page++) {
      const r: any = await xeroGet(tokens, path, { where: `Date>=${dt(FROM)}&&Date<=${dt(TO)}${path === "/Invoices" ? '&&Type=="ACCPAY"' : '&&Type=="ACCPAYCREDIT"'}`, page: String(page) });
      const rows = r[listKey] || [];
      for (const inv of rows) {
        if (["VOIDED", "DELETED", "DRAFT", "SUBMITTED"].includes(inv.Status)) continue;
        let net = 0, tax = 0;
        for (const l of inv.LineItems || []) if (INPUT_TYPES.has(l.TaxType)) { net += Number(l.LineAmount) || 0; tax += Number(l.TaxAmount) || 0; }
        if (net || tax) {
          const k = (inv[numKey] || inv.InvoiceID).trim();
          const cur = xero.get(k) || { net: 0, tax: 0 };
          xero.set(k, { net: R(cur.net + sign * net), tax: R(cur.tax + sign * tax) });
        }
      }
      if (rows.length < 100) break;
    }
  }
  // AIMS: BILL docs (and AP CNs) with taxCode 4-ish in window — replicate report logic
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: { in: ["BILL", "CREDIT_NOTE"] } }, select: { name: true, type: true, status: true, config: true } });
  const aims = new Map<string, { net: number; tax: number }>();
  for (const d of docs) {
    const c: any = d.config;
    if (c.voided) continue;
    const sub = (c.subtype || "").toUpperCase();
    if (d.type === "CREDIT_NOTE" && sub && sub !== "AP") continue;
    const bs = (c.billStatus || "").toUpperCase();
    if (["DRAFT", "VOID"].includes(bs)) continue;
    if ((c.xeroStatus || "").toUpperCase() === "DRAFT" || (c.xeroStatus || "").toUpperCase() === "DELETED" || (c.xeroStatus || "").toUpperCase() === "VOIDED") continue;
    const dateStr = c.billDate || c.date || "";
    const dd = dateStr ? new Date(dateStr) : null;
    if (!dd || dd < FROM || dd > TO) continue;
    const taxCode = c.documentInfo?.taxCode || c.taxCode;
    if (String(taxCode) !== "4") continue;
    const gross = Number(c.totalAmount ?? c.xeroGross ?? c.nettTotal ?? 0);
    const tax = Number(c.taxAmount ?? c.gstAmount ?? c.xeroTax ?? 0);
    const net = R(gross - tax);
    const sign = d.type === "CREDIT_NOTE" ? -1 : 1;
    const k = (d.name || "").trim();
    const cur = aims.get(k) || { net: 0, tax: 0 };
    aims.set(k, { net: R(cur.net + sign * net), tax: R(cur.tax + sign * tax) });
  }
  // diff
  const keys = new Set([...xero.keys(), ...aims.keys()]);
  const diffs: any[] = [];
  for (const k of keys) {
    const x = xero.get(k) || { net: 0, tax: 0 };
    const a = aims.get(k) || { net: 0, tax: 0 };
    if (Math.abs(x.net - a.net) > 0.01 || Math.abs(x.tax - a.tax) > 0.01) diffs.push({ k, xnet: x.net, anet: a.net, dnet: R(a.net - x.net), xtax: x.tax, atax: a.tax, dtax: R(a.tax - x.tax) });
  }
  diffs.sort((p, q) => Math.abs(q.dnet) - Math.abs(p.dnet));
  console.log(`${diffs.length} docs differ; top 25 by net drift (AIMS − Xero):`);
  for (const d of diffs.slice(0, 25)) console.log(`  ${d.k.padEnd(30)} net Δ ${String(d.dnet).padStart(10)} (aims ${d.anet} vs xero ${d.xnet}) · tax Δ ${d.dtax}`);
  console.log("Σ net Δ:", R(diffs.reduce((s, d) => s + d.dnet, 0)), "Σ tax Δ:", R(diffs.reduce((s, d) => s + d.dtax, 0)));
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
