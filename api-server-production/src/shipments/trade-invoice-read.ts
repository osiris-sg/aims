/**
 * Round BQ — what an invoice PDF says: who issued it, its number, total (tax included), currency and due date.
 * Used by the Dashboard "Unpaid" list for the invoices that only exist as files: Mitsui Soko's 請求書 (one per
 * shipment) and its monthly A3279 bill, carriers' debit notes, and customer invoices ADH made outside AIMS (Kato's
 * 請求書 PDFs). Stored as a TradeExtraction of kind INVOICE (read once, on upload or by the backfill script).
 *
 * Text layer first (exact, free): Mitsui Soko's 請求書, ADH's own 請求書, Wan Hai's debit note. Anything else (scans,
 * other layouts) goes to the AI read with INVOICE_PROMPT. Documents are untrusted data: only the fields below are kept.
 */
import { z } from 'zod';
import { nstr, nnum, parseWith } from './trade-extract.rules';

export type InvoiceDocKind = 'invoice' | 'debit_note' | 'statement' | 'receipt' | 'remittance' | 'other';
export interface InvoiceFacts {
  docKind: InvoiceDocKind;
  issuer: string | null;
  invoiceNo: string | null;
  /** The issuer's job / shipment reference (Mitsui Soko IM3Z…): a re-issued invoice with the same reference replaces the earlier one. */
  reference?: string | null;
  issueDate: string | null;
  /** お支払い期限 / Due Date (YYYY-MM-DD). */
  dueDate: string | null;
  /** "Pay together with the next invoice" (ADH's 正誤差額 / 実費差分: 次回ご請求書お支払い期限までに). */
  dueWithNext: boolean;
  currency: string | null;
  /** Total to pay, tax included; negative = a credit. */
  total: number | null;
  via: 'text' | 'ai';
  layout: string;
}

const num = (s: string | undefined | null) => {
  if (!s) return null;
  const n = Number(s.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const pad = (n: number | string) => String(n).padStart(2, '0');
const ymd = (y: number | string, m: number | string, d: number | string) => `${y}-${pad(m)}-${pad(d)}`;
const lastDayOf = (y: number, m: number) => ymd(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Mitsui Soko's 請求書 (ADH's customer code A3279): ¥ total, invoice no. 2FME…, "10月 末日迄" = end of that month. */
export function readMitsuiSokoText(text: string): InvoiceFacts | null {
  if (!/A3279/.test(text) || !/末日迄/.test(text)) return null;
  const total = num(text.match(/¥\s*([\d,]+)\s*-/)?.[1]);
  const invoiceNo = text.match(/\b(2FME[A-Z0-9]{4,})\b/)?.[1] ?? null;
  const dates = [...text.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)].map((m) => ymd(m[1], m[2], m[3]));
  const issueDate = dates[0] ?? null;
  const dueMonth = Number(text.match(/(\d{1,2})月\s*末日迄/)?.[1]);
  let dueDate: string | null = null;
  if (issueDate && dueMonth >= 1 && dueMonth <= 12) {
    // "10月 末日迄" on an invoice re-issued on 2 Nov still means 31 Oct of that year (a December invoice due in January rolls over).
    const y = Number(issueDate.slice(0, 4)) + (Number(issueDate.slice(5, 7)) - dueMonth > 6 ? 1 : 0);
    dueDate = lastDayOf(y, dueMonth);
  }
  if (total === null || !invoiceNo) return null;
  const reference = text.match(/\b(IM[0-9A-Z]{6,})\b/)?.[1] ?? null;
  return { docKind: 'invoice', issuer: 'Mitsui Soko (三井倉庫)', invoiceNo, reference, issueDate, dueDate, dueWithNext: false, currency: 'JPY', total, via: 'text', layout: 'mitsui-soko' };
}

/** ADH's own 請求書 (Excel → PDF): 番号, 合計(税込) $… / (US$…) for a credit, "YYYY/M/D までにお支払い" or 次回… */
export function readAdhInvoiceText(text: string): InvoiceFacts | null {
  if (!/アジアディールハブ/.test(text) || !/番号[：:]/.test(text) || !/合計\(税込\)/.test(text)) return null;
  const invoiceNo = text.match(/番号[：:]\s*([0-9A-Za-z_\-]+)/)?.[1] ?? null;
  const t = text.match(/合計\(税込\)\s*(\()?\s*(US\$|\$|¥|￥)\s*([\d,]+(?:\.\d+)?)\s*\)?/);
  if (!t) return null;
  const amount = num(t[3]);
  if (amount === null) return null;
  const total = t[1] ? -amount : amount;
  const currency = t[2] === '¥' || t[2] === '￥' ? 'JPY' : 'USD';
  const issue = text.match(/発行日[：:]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  const due = text.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s*までにお支払い/);
  const dueWithNext = !due && /次回ご請求書お支払い期限/.test(text);
  return {
    docKind: 'invoice',
    issuer: 'Asia Deal Hub',
    invoiceNo,
    issueDate: issue ? ymd(issue[1], issue[2], issue[3]) : null,
    dueDate: due ? ymd(due[1], due[2], due[3]) : null,
    dueWithNext,
    currency,
    total,
    via: 'text',
    layout: 'adh-invoice',
  };
}

/** Wan Hai's container detention / demurrage DEBIT NOTE: GRAND TOTAL: YEN …, the B/L no. as its reference (no due date printed). */
export function readWanHaiText(text: string): InvoiceFacts | null {
  if (!/WAN HAI LINES/.test(text) || !/DEBIT NOTE/.test(text)) return null;
  const total = num(text.match(/GRAND TOTAL:\s*YEN\s*([\d,]+)/)?.[1]);
  if (total === null) return null;
  const bl = text.match(/B\/L NO\s*:\s*([A-Z0-9]+)/)?.[1] ?? null;
  const what = /Detention/i.test(text) ? 'Detention' : /Demurrage/i.test(text) ? 'Demurrage' : 'Debit note';
  return { docKind: 'debit_note', issuer: 'Wan Hai Lines', invoiceNo: bl ? `${what} ${bl}` : what, issueDate: null, dueDate: null, dueWithNext: false, currency: 'JPY', total, via: 'text', layout: 'wan-hai-debit-note' };
}

/** Maersk's IMPORT INVOICE: Invoice Number, Due Date "Nov 2, 2026", total incl. tax. */
export function readMaerskText(text: string): InvoiceFacts | null {
  if (!/Maersk/.test(text) || !/Invoice Number\s+\d+/.test(text)) return null;
  const invoiceNo = text.match(/Invoice Number\s+(\d+)/)?.[1] ?? null;
  const d = (label: string) => {
    const m = text.match(new RegExp(`${label}\\s+([A-Z][a-z]{2})\\s+(\\d{1,2}),\\s*(\\d{4})`));
    return m && MONTHS[m[1].toLowerCase()] ? ymd(m[3], MONTHS[m[1].toLowerCase()], m[2]) : null;
  };
  const payable = text.match(/Total Payable Amount\s+(JPY|USD)\s*([\d,]+(?:\.\d+)?)/);
  const total = num(payable?.[2]);
  const cur = payable?.[1] ?? null;
  if (total === null || !invoiceNo) return null;
  return { docKind: 'invoice', issuer: 'Maersk', invoiceNo, issueDate: d('Invoice Date'), dueDate: d('Due Date'), dueWithNext: false, currency: cur ?? 'JPY', total, via: 'text', layout: 'maersk' };
}

const TEXT_READERS = [readMitsuiSokoText, readAdhInvoiceText, readWanHaiText, readMaerskText];

/** The text-layer read, or null when no known layout matches (→ the AI read). */
export function invoiceFromText(text: string): InvoiceFacts | null {
  if (!text || text.replace(/\s/g, '').length < 40) return null;
  for (const r of TEXT_READERS) {
    const f = r(text);
    if (f) return f;
  }
  return null;
}

export const INVOICE_SCHEMA = z.object({
  docKind: z.enum(['invoice', 'debit_note', 'statement', 'receipt', 'remittance', 'other']).catch('other').default('other'),
  issuer: nstr.default(null),
  invoiceNo: nstr.default(null),
  issueDate: nstr.default(null),
  dueDate: nstr.default(null),
  dueWithNext: z.boolean().catch(false).default(false),
  currency: nstr.default(null),
  total: nnum.default(null),
});

export const INVOICE_SYSTEM_PROMPT =
  'You read invoices, bills and debit notes sent to a Japanese trading company (Asia Deal Hub) by warehouses, hauliers, shipping lines and customs brokers, or issued by it to its customers. The PDF may be a scanned image — read the page images. Transcribe values exactly as printed; never invent a value — use null when it is not on the document. Output STRICT JSON only.';

export const INVOICE_USER_PROMPT = `The file may hold SEVERAL invoices (one per page or more). Extract every one into exactly this JSON (null when absent):
{ "invoices": [ {
  "docKind": "invoice | debit_note | statement | receipt | remittance | other — a payment receipt, remittance advice or bank slip is NOT an invoice",
  "issuer": "the company that issued it (e.g. \\"Mitsui Soko\\", \\"Wan Hai Lines\\", \\"Maersk\\")",
  "invoiceNo": "the invoice / bill / debit note number as printed",
  "issueDate": "issue date as YYYY-MM-DD",
  "dueDate": "payment due date as YYYY-MM-DD (お支払い期限 / 支払期日; \\"10月末日迄\\" = the last day of that month)",
  "dueWithNext": "true only when it says to pay together with the next invoice",
  "currency": "JPY or USD (¥ / 円 = JPY)",
  "total": "the total amount to pay INCLUDING consumption tax (請求金額 / ご請求金額 / 合計 / GRAND TOTAL), as a number"
} ] }`;

/** One name per issuer, whatever language the read came back in. */
export function issuerName(s: string | null): string | null {
  if (!s) return null;
  if (/三井倉庫|mitsui\s*soko/i.test(s)) return 'Mitsui Soko (三井倉庫)';
  if (/wan\s*hai|ワンハイ/i.test(s)) return 'Wan Hai Lines';
  if (/maersk|マースク/i.test(s)) return 'Maersk';
  return s.trim();
}

/** The AI read in InvoiceFacts form — every invoice in the file (dates kept only when they are real YYYY-MM-DD). */
export function invoicesFromAi(raw: unknown): InvoiceFacts[] {
  const list = Array.isArray((raw as any)?.invoices) ? (raw as any).invoices : [raw];
  return list.map((x: unknown) => invoiceFromAi(x));
}

export function invoiceFromAi(raw: unknown): InvoiceFacts {
  const r = parseWith(INVOICE_SCHEMA, raw, 'invoice');
  const day = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null);
  const cur = (r.currency ?? '').toUpperCase();
  return {
    docKind: r.docKind,
    issuer: issuerName(r.issuer),
    invoiceNo: r.invoiceNo,
    issueDate: day(r.issueDate),
    dueDate: day(r.dueDate),
    dueWithNext: r.dueWithNext,
    currency: /JPY|YEN|円|¥/.test(cur) ? 'JPY' : /USD|\$/.test(cur) ? 'USD' : cur || null,
    total: r.total,
    via: 'ai',
    layout: 'ai',
  };
}

/** Is it something to pay (not a receipt / remittance advice / statement)? */
export const isPayable = (f: InvoiceFacts | null | undefined) => !!f && (f.docKind === 'invoice' || f.docKind === 'debit_note');

/** Read one file: the text layer, else the AI (only when `ai` is given; one retry). Never throws for an unreadable file. */
export async function readInvoiceBuffer(
  buffer: Buffer,
  mimeType: string,
  deps: { pdfText: (b: Buffer) => Promise<string>; ai?: (buffer: Buffer, mimeType: string) => Promise<unknown> },
): Promise<{ invoices: InvoiceFacts[] | null; error: string | null }> {
  const text = mimeType === 'application/pdf' ? await deps.pdfText(buffer).catch(() => '') : '';
  const fromText = invoiceFromText(text);
  if (fromText) return { invoices: [fromText], error: null };
  if (!deps.ai) return { invoices: null, error: 'no text layer the reader knows' };
  let error = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return { invoices: invoicesFromAi(await deps.ai(buffer, mimeType)), error: null };
    } catch (e) {
      error = (e as Error)?.message ?? String(e);
    }
  }
  return { invoices: null, error };
}
