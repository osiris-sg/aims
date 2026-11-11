/**
 * Round BS — ADH's OWN outgoing invoices (請求書送付 from finance@ / Sayaka): which order a 請求書 PDF belongs to.
 *
 * Read from the PDF's text: invoice no. (202611_01), the invoice it corrects (正誤差額 / 実費差分: "請求書 202610_003
 * との差額"), customer (…御中), grade (6063 / 6005 / 6063 HSB), delivery month (202612納入 / 12月納入) and quantity.
 * Matched on all of them together — never on the net weight alone: Kato's Nov and Dec 6063 are both 40.271 t
 * (Sayaka, 2026-11-11), so 40.271 t by itself picks nothing.
 *   1. the invoice it corrects is already in AIMS → that order ("corrects 202610_003 on #22");
 *   2. its own number is already in AIMS → that order;
 *   3. customer + grade + delivery month → the one open order; several → the quantity decides; still several → none.
 * Documents are untrusted data: only these fields are read.
 */
import { readAdhInvoiceText } from '../shipments/trade-invoice-read';

export interface OutgoingInvoice {
  kind: 'invoice' | 'correction';
  invoiceNo: string | null;
  /** The invoice a 正誤差額 / 実費差分 corrects. */
  refInvoiceNo: string | null;
  issueDate: string | null;
  /** The 御中 line (customer as printed). */
  addressee: string | null;
  grade: string | null;
  /** YYYY-MM. */
  deliveryMonth: string | null;
  qtyMt: number | null;
  total: number | null;
  currency: string | null;
}

const INV_NO = /\b(\d{6}_\d{2,3}|\d{8}-\d{2})\b/g;
const pad = (n: number) => String(n).padStart(2, '0');
export const normGrade = (g: string | null | undefined) => (g ?? '').toUpperCase().replace(/\s+/g, ' ').trim() || null;

/** The invoice's facts, or null when this is not one of ADH's 請求書. */
export function readOutgoingInvoice(text: string, fileName = ''): OutgoingInvoice | null {
  const base = readAdhInvoiceText(text);
  if (!base) return null;
  const hay = `${fileName}\n${text}`;
  const kind: OutgoingInvoice['kind'] = /正誤差額|実費差分|との差額/.test(hay) ? 'correction' : 'invoice';
  const nos = [...text.matchAll(INV_NO)].map((m) => m[1]);
  const refInvoiceNo = kind === 'correction' ? (/(\d{6}_\d{2,3})\s*との差額/.exec(text)?.[1] ?? nos.find((n) => n !== base.invoiceNo) ?? null) : null;
  const addressee = /([^\n]{2,60}?)\s*御中/.exec(text)?.[1]?.trim() ?? null;
  // Grade: the 件名 / 摘要 line ("アルミニウムビレット 6063 8 インチ"), else the file name ("…6063‗22t…").
  const g = /アルミ(?:ニウム)?ビレット\s*([0-9]{4})((?:\s*\d+\s*(?:インチ|inch))?\s*HSB)?/i.exec(text) ?? /(?:^|[^0-9])(6\d{3}|1070|P1020)(\s*HSB)?(?:[^0-9]|$)/i.exec(fileName);
  const grade = g ? normGrade(`${g[1]}${/HSB/i.test(g[2] ?? '') ? ' HSB' : ''}`) : null;
  // Delivery month: "202612納入" (YYYYMM), else "12月納入" in the issue year (a month well before the issue rolls over).
  let deliveryMonth: string | null = null;
  const ym = /(20\d{2})(0[1-9]|1[0-2])\s*納入/.exec(hay);
  if (ym) deliveryMonth = `${ym[1]}-${ym[2]}`;
  else {
    const m = /(\d{1,2})月\s*納入/.exec(hay);
    const issue = base.issueDate ?? null;
    if (m && issue) {
      const mon = Number(m[1]);
      const y = Number(issue.slice(0, 4)) + (Number(issue.slice(5, 7)) - mon > 6 ? 1 : 0);
      if (mon >= 1 && mon <= 12) deliveryMonth = `${y}-${pad(mon)}`;
    }
  }
  const q = /(\d{1,3}\.\d{3})\s*(?:MT|ＭＴ|T\b|ｔ)/i.exec(hay) ?? /(?:^|\s)(\d{1,3}\.\d{3})\s/.exec(text);
  const qtyMt = q ? Number(q[1]) : null;
  return { kind, invoiceNo: base.invoiceNo, refInvoiceNo, issueDate: base.issueDate, addressee, grade, deliveryMonth, qtyMt, total: base.total, currency: base.currency };
}

export interface InvoiceOrder {
  orderId: string;
  ref: string;
  customerNames: string[];
  grade: string | null;
  deliveryMonth: string | null;
  qtyMt: number | null;
  netMts: number[];
}

/** Which open order an outgoing invoice belongs to (pure; tested). `filed` = invoice numbers already in AIMS by order. */
export function matchOutgoingInvoice(inv: OutgoingInvoice, orders: InvoiceOrder[], filed: Array<{ invoiceNo: string; orderId: string; ref: string }>): { orderId: string; why: string } | null {
  if (inv.refInvoiceNo) {
    const f = filed.find((x) => x.invoiceNo === inv.refInvoiceNo);
    if (f) return { orderId: f.orderId, why: `corrects invoice ${inv.refInvoiceNo} (on ${f.ref})` };
  }
  if (inv.invoiceNo) {
    const f = filed.find((x) => x.invoiceNo === inv.invoiceNo);
    if (f) return { orderId: f.orderId, why: `invoice ${inv.invoiceNo} is already on ${f.ref}` };
  }
  if (!inv.grade || !inv.deliveryMonth) return null;
  const who = (inv.addressee ?? '').replace(/\s+/g, '');
  const byCustomer = orders.filter((o) => !who || o.customerNames.some((n) => n && (who.includes(n.replace(/\s+/g, '')) || n.replace(/\s+/g, '').includes(who))));
  let hits = byCustomer.filter((o) => normGrade(o.grade) === inv.grade && o.deliveryMonth === inv.deliveryMonth);
  const month = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const why = (o: InvoiceOrder, extra = '') => `${inv.invoiceNo ? `invoice ${inv.invoiceNo} · ` : ''}${inv.grade} · ${month(inv.deliveryMonth!)} delivery${extra} → ${o.ref}`;
  if (hits.length > 1 && inv.qtyMt !== null) {
    const q = inv.qtyMt;
    const close = hits.filter((o) => o.netMts.some((n) => Math.abs(n - q) < 0.0005) || (o.qtyMt !== null && Math.abs(o.qtyMt - q) <= Math.max(1, o.qtyMt * 0.05)));
    if (close.length === 1) return { orderId: close[0].orderId, why: why(close[0], ` · ${q} t`) };
    hits = close.length ? close : hits;
  }
  return hits.length === 1 ? { orderId: hits[0].orderId, why: why(hits[0]) } : null;
}
