// Pin the box6 155.95: per-XERO-INVOICE-ID tax diff (immune to number
// shuffles — join AIMS↔Xero by xeroInvoiceId, not name).
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const R = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const FROM = new Date("2026-07-01T00:00:00.000Z"), TO = new Date("2026-09-30T23:59:59.999Z");
const OUT = new Set(["TAX001", "OUTPUTY24", "OUTPUTY23", "OUTPUT"]);
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const dt = (d: Date) => `DateTime(${d.getUTCFullYear()},${d.getUTCMonth() + 1},${d.getUTCDate()})`;
  // Xero: output tax per invoice ID (+ CNs negative)
  const xero = new Map<string, { tax: number; num: string; cust: string; status: string }>();
  for (const [type, path, listKey] of [["ACCREC", "/Invoices", "Invoices"], ["ACCRECCREDIT", "/CreditNotes", "CreditNotes"]] as any) {
    for (let page = 1; ; page++) {
      const r: any = await xeroGet(tokens, path, { where: `Type=="${type}"&&Date>=${dt(FROM)}&&Date<=${dt(TO)}`, page: String(page) });
      const rows = r[listKey] || [];
      for (const doc of rows) {
        if (["VOIDED", "DELETED", "DRAFT", "SUBMITTED"].includes(doc.Status)) continue;
        let tax = 0;
        for (const li of doc.LineItems || []) if (OUT.has(li.TaxType)) tax += Number(li.TaxAmount) || 0;
        if (tax) xero.set(doc.InvoiceID || doc.CreditNoteID, { tax: R(tax * (String(type).endsWith("CREDIT") ? -1 : 1)), num: doc.InvoiceNumber || doc.CreditNoteNumber, cust: doc.Contact?.Name || "", status: doc.Status });
      }
      if (rows.length < 100) break;
    }
  }
  // AIMS: output tax per linked xero id (verifier logic, tax portion)
  const MAP: Record<string, string> = { TAX001: "OUT", OUTPUTY24: "OUT", OUTPUTY23: "OUT", OUTPUT: "OUT" };
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: { in: ["INVOICE", "TI", "TI2", "CREDIT_NOTE"] } }, select: { name: true, type: true, status: true, createdAt: true, config: true } });
  const aims = new Map<string, { tax: number; name: string }>();
  for (const doc of docs) {
    const c: any = doc.config || {};
    if (c.voided) continue;
    const status = (doc.status || "").toLowerCase();
    if (status === "draft" || status === "cancelled") continue;
    const di: any = c.documentInfo || {};
    const date = c.date ? new Date(c.date) : c.billDate ? new Date(c.billDate) : doc.createdAt;
    if (date < FROM || date > TO) continue;
    const id = c.xeroInvoiceId || c.xeroCreditNoteId;
    if (!id) continue;
    const items: any[] = Array.isArray(c.items) ? c.items : [];
    const typed = items.filter((it) => it?.taxType && MAP[String(it.taxType)]);
    let tax = 0;
    if (typed.length) tax = typed.reduce((s, it) => s + (Number(it.taxAmount) || 0), 0);
    else if (di.taxCode === "1" || di.taxCode === "8" || di.taxCode === "10") tax = Number(di.gstAmount ?? c.taxAmount ?? c.xeroTax ?? 0) || 0;
    else continue;
    const sign = doc.type === "CREDIT_NOTE" ? -1 : 1;
    const cur = aims.get(id) || { tax: 0, name: doc.name || "" };
    aims.set(id, { tax: R(cur.tax + tax * sign), name: doc.name || "" });
  }
  const ids = new Set([...xero.keys(), ...aims.keys()]);
  const diffs: any[] = [];
  for (const id of ids) {
    const x = xero.get(id), a = aims.get(id);
    const d = R((a?.tax || 0) - (x?.tax || 0));
    if (Math.abs(d) > 0.005) diffs.push({ id, d, xnum: x?.num, xtax: x?.tax || 0, aname: a?.name, atax: a?.tax || 0, cust: x?.cust, status: x?.status });
  }
  diffs.sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
  console.log(`${diffs.length} true per-doc diffs (by Xero ID):`);
  for (const d of diffs) console.log(`  Δ ${String(d.d).padStart(8)} · xero ${d.xnum || "—"} [${d.status || "—"}] $${d.xtax} vs aims ${d.aname || "NO DOC"} $${d.atax} · ${(d.cust || "").slice(0, 30)}`);
  console.log("Σ:", R(diffs.reduce((s, d) => s + d.d, 0)));
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
