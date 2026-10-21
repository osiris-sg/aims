// Display formatting for the Shipments pages: MT to 3 decimals, money to 2,
// dates as DD MMM YYYY.

import type { Num, RecordStatus, StepStatus } from "./api";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

const toNumber = (v: Num | undefined) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const fmtMt = (v: Num | undefined) => {
  const n = toNumber(v);
  return n === null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
};

export const fmtMoney = (v: Num | undefined, currency?: string | null) => {
  const n = toNumber(v);
  if (n === null) return "—";
  const s = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${s}` : s;
};

/** Calendar dates (ETD/ETA) are stored as UTC midnight — read them in UTC so they never shift a day. */
export const fmtDay = (d?: string | null) => {
  if (!d) return "—";
  const x = new Date(d);
  if (isNaN(x.getTime())) return "—";
  return `${pad(x.getUTCDate())} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
};

/** Timestamps (uploaded / done at) in local time. */
export const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  const x = new Date(d);
  if (isNaN(x.getTime())) return "—";
  return `${pad(x.getDate())} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`;
};

export const fmtDateTime = (d?: string | null) => {
  if (!d) return "—";
  const x = new Date(d);
  if (isNaN(x.getTime())) return "—";
  return `${fmtDate(d)}, ${pad(x.getHours())}:${pad(x.getMinutes())}`;
};

/** "2026-10" → "Oct 2026". */
export const fmtMonth = (m?: string | null) => {
  const r = /^(\d{4})-(\d{2})$/.exec(m || "");
  return r ? `${MONTHS[Number(r[2]) - 1]} ${r[1]}` : m || "—";
};

/** ISO → yyyy-mm-dd for a date input (UTC, matching fmtDay). */
export const toDateInput = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export const RECORD_STATUS: Record<RecordStatus, { label: string; color: "info" | "success" | "default" }> = {
  OPEN: { label: "Open", color: "info" },
  COMPLETED: { label: "Completed", color: "success" },
  CANCELLED: { label: "Cancelled", color: "default" },
};

export const STEP_STATUS: Record<StepStatus, { label: string; color: "default" | "warning" | "success" | "secondary" }> = {
  NOT_STARTED: { label: "Not started", color: "default" },
  IN_PROGRESS: { label: "In progress", color: "warning" },
  DONE: { label: "Done", color: "success" },
  // Can't be set any more; only legacy rows can still carry it.
  SKIPPED: { label: "Skipped (legacy)", color: "secondary" },
};

export const blLabel = (bl?: string | null) => bl || "B/L pending";

/** Doc types that can be met by an in-app invoice instead of an uploaded file. */
export const INVOICE_DOC_TYPES = ["INVOICE_1", "INVOICE_2", "INVOICE_SINGLE"];

/** Editor URL for an in-app document; ?from= brings Back (and the nav highlight) to `from`. */
export const documentHref = (d: { type: string; templateId: string; id: string }, from?: string) =>
  `/portal/documents/${d.type}/${d.templateId}/${d.id}${from ? `?from=${encodeURIComponent(from)}` : ""}`;

export const DOC_STATUS_LABEL = (s: string) => (s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—");

/** Documents-hub categories (TradeDocType.category), in display order. */
export const DOC_CATEGORIES: Array<{ code: string; label: string }> = [
  { code: "SUPPLIER", label: "Supplier documents" },
  { code: "CUSTOMER", label: "Customer documents" },
  { code: "INVOICES", label: "Invoices" },
  { code: "CUSTOMS_LOGISTICS", label: "Customs & logistics" },
  { code: "PAYMENTS", label: "Payments" },
  { code: "OTHER", label: "Other" },
];
export const categoryLabel = (code: string) => DOC_CATEGORIES.find((c) => c.code === code)?.label ?? code;

/** Doc types that can be created in-app from the supplier spreadsheet. */
/**
 * Document types ADH can make in-app (mirrors GENERATED_TEMPLATES on the API):
 * which record they belong to, the "Create" menu wording, and — Customer PL /
 * COA — the supplier spreadsheet that can prefill them.
 */
export const GENERATED_DOC_TYPES: Record<string, { scope: "shipment" | "contract" | "order"; createLabel: string; source?: string; sourceLabel?: string; sourceFiles?: string; multiple?: boolean; covers?: boolean }> = {
  CUSTOMER_PL: { scope: "shipment", createLabel: "Create blank (計量検収票)", source: "PL", sourceLabel: "packing list", sourceFiles: "spreadsheet (.xls, .xlsx, .csv or .txt)" },
  CUSTOMER_COA: { scope: "shipment", createLabel: "Create blank (納品書兼分析試験成績報告書)", source: "COA", sourceLabel: "COA", sourceFiles: "COA spreadsheet (COA.XLS) or COA PDF (COA_集計 / Vedanta's COA)" },
  INVOICE_1: { scope: "order", createLabel: "Create ADH invoice (請求書)" },
  // Invoice #2 / the single invoice can bill several shipments of the customer (picked when creating it).
  INVOICE_2: { scope: "shipment", createLabel: "Create ADH invoice (請求書)", covers: true },
  INVOICE_SINGLE: { scope: "shipment", createLabel: "Create invoice (請求書, single)", covers: true },
  // A shipment arriving in two lots (先着 / 後着) gets one per arrival.
  SGJP_IV_PL: { scope: "shipment", createLabel: "Create SG→JP invoice & packing list", multiple: true },
  SHIPPING_INSTRUCTIONS: { scope: "shipment", createLabel: "Create 出庫・納入依頼書" },
};

/** "6063 · 152MM · 30 MT" for a contract product line. */
export const lineLabel = (l: { grade?: string | null; product?: string | null; sizeSpec?: string | null; quantityMt?: Num }) => {
  const q = toNumber(l.quantityMt ?? null);
  return [l.grade || l.product || null, l.sizeSpec || null, q === null ? null : `${q.toLocaleString("en-US", { maximumFractionDigits: 3 })} MT`].filter(Boolean).join(" · ") || "Product line";
};

/** "Aluminium Billet 6063": the shipment commodity a line implies. */
export const commodityOf = (l: { product?: string | null; grade?: string | null }) => [l.product, l.grade].filter(Boolean).join(" ");

/** "{displayNo}. {title}" — the org's step number, else the position, else the bare title (mirrors the API's stepLabel). */
export const stepLabel = (s: { title: string; displayNo?: string | null }, position?: number) => {
  const no = s.displayNo?.trim() || (position ? String(position) : "");
  return no ? `${no}. ${s.title}` : s.title;
};

/** Calendar date (stored UTC midnight, or YYYY-MM-DD) as DD/MM/YYYY — ADH's own date style. */
export const fmtDmy = (d?: string | null) => {
  if (!d) return "—";
  const x = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : d);
  if (isNaN(x.getTime())) return "—";
  return `${pad(x.getUTCDate())}/${pad(x.getUTCMonth() + 1)}/${x.getUTCFullYear()}`;
};

/** "3 business days" / "10 calendar days" — the contract's deposit term. */
export const depositTermLabel = (days?: number | null, unit?: string | null) =>
  days === null || days === undefined ? null : `${days} ${unit === "CALENDAR" ? "calendar" : "business"} day${days === 1 ? "" : "s"}`;

/** "¥1,526,676" (yen, no decimals); "—" for null. */
export const fmtYen = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `¥${Math.round(v).toLocaleString("en-US")}`);
/** "US$18,042.43"; "—" for null. */
export const fmtUsd = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v < 0 ? "-" : ""}US$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "Sep 26" for "2026-09". */
export const monthShort = (m?: string | null) => {
  const x = /^(\d{4})-(\d{2})$/.exec(m ?? "");
  return x ? `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(x[2]) - 1]} ${x[1].slice(2)}` : "";
};

/**
 * Round Q: the customer's short name for lists ("Kato Light Metal Industry Co., Ltd." → "Kato Light Metal Industry";
 * "SUS Co., Ltd." → "SUS"); known customers by their key word (Kato / SUS / Hoei). The full name stays in the
 * tooltip and on documents.
 */
export function shortCustomer(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  if (!n) return null;
  if (/加藤|\bkato\b/i.test(n)) return "Kato";
  if (/\bSUS\b|エスユーエス/i.test(n)) return "SUS";
  if (/豊栄|ホーエイ|\bhoei\b|\bhouei\b/i.test(n)) return "Hoei";
  return (
    n
      .replace(/株式会社|合同会社|有限会社/g, "")
      .replace(/[,.]?\s*\b(co|ltd|limited|inc|corp|corporation|company|pte|pvt|llc|gmbh|kk)\b\.?/gi, "")
      .replace(/[\s,.]+$/, "")
      .trim() || n
  );
}
