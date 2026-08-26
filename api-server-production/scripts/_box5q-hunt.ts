// Hunt the box5 -86.78: per-doc INPUT net, AIMS (verifier logic verbatim,
// incl. line-level path) vs Xero (inclusive-netted lines). All doc types.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const R = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const FROM = new Date("2026-07-01T00:00:00.000Z"), TO = new Date("2026-09-30T23:59:59.999Z");
const MAP: Record<string, { code: string; side: "OUTPUT" | "INPUT" }> = {
  TAX001: { code: "1", side: "OUTPUT" }, OUTPUTY24: { code: "1", side: "OUTPUT" },
  OUTPUTY23: { code: "8", side: "OUTPUT" }, OUTPUT: { code: "10", side: "OUTPUT" },
  TAX002: { code: "4", side: "INPUT" }, INPUTY24: { code: "4", side: "INPUT" },
  INPUTY23: { code: "9", side: "INPUT" }, INPUT: { code: "11", side: "INPUT" },
  ZERORATEDOUTPUT: { code: "2", side: "OUTPUT" }, ZERORATEDINPUT: { code: "5", side: "INPUT" },
  OSOUTPUT: { code: "13", side: "OUTPUT" }, OPINPUT: { code: "12", side: "INPUT" },
};
const PC = new Set(["4", "5", "7", "9", "11"]);
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const dt = (d: Date) => `DateTime(${d.getUTCFullYear()},${d.getUTCMonth() + 1},${d.getUTCDate()})`;
  const dateFilter = `Date>=${dt(FROM)}&&Date<=${dt(TO)}`;
  const xero = new Map<string, number>();
  const addX = (k: string, v: number) => xero.set(k, R((xero.get(k) || 0) + v));
  for (const [type, path, listKey, numKey] of [["ACCREC", "/Invoices", "Invoices", "InvoiceNumber"], ["ACCPAY", "/Invoices", "Invoices", "InvoiceNumber"], ["ACCRECCREDIT", "/CreditNotes", "CreditNotes", "CreditNoteNumber"], ["ACCPAYCREDIT", "/CreditNotes", "CreditNotes", "CreditNoteNumber"]] as any) {
    for (let page = 1; ; page++) {
      const r: any = await xeroGet(tokens, path, { where: `Type=="${type}"&&${dateFilter}`, page: String(page), pageSize: "100" });
      const rows = r[listKey] || [];
      for (const doc of rows) {
        if (["VOIDED", "DELETED", "DRAFT", "SUBMITTED"].includes(doc.Status || "")) continue;
        const cnSign = String(type).endsWith("CREDIT") ? -1 : 1;
        for (const li of doc.LineItems || []) {
          const m = MAP[li.TaxType as string];
          if (!m || m.side !== "INPUT" || !PC.has(m.code)) continue;
          const net = (Number(li.LineAmount) || 0) - (doc.LineAmountTypes === "Inclusive" ? Number(li.TaxAmount) || 0 : 0);
          addX((doc[numKey] || "").trim(), R(net * cnSign));
        }
      }
      if (rows.length < 100) break;
    }
  }
  // AIMS verbatim
  const [docs, taxRates] = await Promise.all([
    prisma.document.findMany({ where: { organizationId: ORG, type: { in: ["INVOICE", "TI", "TI2", "BILL", "CREDIT_NOTE", "DEBIT_NOTE", "PURCHASE_RETURN"] } }, select: { name: true, type: true, status: true, createdAt: true, config: true } }),
    prisma.taxRate.findMany({ where: { organizationId: ORG } }),
  ]);
  const rateByCode = new Map(taxRates.map((t: any) => [t.code, t]));
  const aims = new Map<string, number>();
  const addA = (k: string, v: number) => aims.set(k, R((aims.get(k) || 0) + v));
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
        if (m.side !== "INPUT" || !PC.has(m.code)) continue;
        addA(key, R((Number(it.amount) || 0) * signFor(m.side)));
      }
      continue;
    }
    const code = di.taxCode != null && di.taxCode !== "" ? String(di.taxCode) : null;
    if (!code || !PC.has(code)) continue;
    const tr: any = rateByCode.get(code);
    const side = (tr?.direction as any) || (doc.type === "BILL" || doc.type === "PURCHASE_RETURN" ? "INPUT" : "OUTPUT");
    if (side !== "INPUT") continue;
    const tax = R(Number(di.gstAmount ?? c.taxAmount ?? c.xeroTax ?? 0) || 0);
    let net = Number(di.subTotal ?? c.subtotal ?? c.subTotal ?? NaN);
    if (!Number.isFinite(net)) { const gross = Number(c.xeroGross ?? di.nettTotal ?? c.nettTotal ?? c.totalAmount ?? 0) || 0; net = R(gross - tax); } else net = R(net);
    addA(key, R(net * signFor(side)));
  }
  const keys = new Set([...aims.keys(), ...xero.keys()]);
  const diffs: any[] = [];
  for (const k of keys) {
    const a = aims.get(k) || 0, x = xero.get(k) || 0;
    if (Math.abs(a - x) > 0.005) diffs.push({ k, a, x, d: R(a - x) });
  }
  diffs.sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
  console.log(`${diffs.length} docs differ:`);
  for (const d of diffs) console.log(`  ${d.k.padEnd(40)} Δ ${String(d.d).padStart(9)}  (aims ${d.a} vs xero ${d.x})`);
  console.log("Σ:", R(diffs.reduce((s, d) => s + d.d, 0)));
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
