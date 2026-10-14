/**
 * Pure Shipments-module rules (no Prisma, no Nest) so they can be unit tested
 * on their own. The services load rows inside a transaction and call these to
 * decide whether a step / record / file change is allowed.
 */

// SKIPPED stays in the Prisma enum for old rows, but nothing sets it any more.
export type StepStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'SKIPPED';
export type RecordStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED';

export const STEP_STATUSES: StepStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'SKIPPED'];
export const RECORD_STATUSES: RecordStatus[] = ['OPEN', 'COMPLETED', 'CANCELLED'];

export interface StepLike {
  id: string;
  title: string;
  status: string;
  isOngoing: boolean;
  requiredDocTypes: string[];
}

/** Required doc-type codes with no file of that type in `present`. */
export function missingDocTypes(required: string[], present: Iterable<string>): string[] {
  const have = new Set(present);
  return [...new Set(required)].filter((code) => !have.has(code));
}

/**
 * Steps that stop a contract/shipment from completing: every non-ongoing step
 * must be DONE. (Skipping was removed; a legacy SKIPPED row blocks until it is
 * reopened and completed.)
 */
export function blockingSteps<T extends StepLike>(steps: T[]): T[] {
  return steps.filter((s) => !s.isOngoing && s.status !== 'DONE');
}

/**
 * DONE steps that would be left missing a required doc type once only the doc
 * types in `presentAfter` remain linked to their contract/shipment.
 */
export function stepsBrokenByRemoval<T extends StepLike>(steps: T[], presentAfter: Iterable<string>): Array<{ step: T; missing: string[] }> {
  const have = new Set(presentAfter);
  return steps
    .filter((s) => s.status === 'DONE')
    .map((step) => ({ step, missing: missingDocTypes(step.requiredDocTypes, have) }))
    .filter((r) => r.missing.length > 0);
}

/** {done,total} over non-ongoing steps; only DONE counts. */
export function progressOf(steps: Array<{ status: string; isOngoing: boolean }>): { done: number; total: number } {
  const counted = steps.filter((s) => !s.isOngoing);
  return { done: counted.filter((s) => s.status === 'DONE').length, total: counted.length };
}

/** Document statuses that are still drafts: a linked invoice in one of these doesn't count yet. */
export const DRAFT_DOCUMENT_STATUSES = ['draft', 'unconfirmed'];

/**
 * How a linked in-app document (invoice) stands for step requirements. Only a
 * CONFIRMED one (any status past draft/unconfirmed) counts; deleted, voided and
 * draft ones are listed but don't satisfy anything.
 */
export function documentLinkState(doc: { status: string; config: unknown } | null | undefined): { state: 'deleted' | 'voided' | 'draft' | 'confirmed'; satisfies: boolean } {
  if (!doc) return { state: 'deleted', satisfies: false };
  if ((doc.config as { voided?: unknown } | null)?.voided) return { state: 'voided', satisfies: false };
  if (DRAFT_DOCUMENT_STATUSES.includes(doc.status)) return { state: 'draft', satisfies: false };
  return { state: 'confirmed', satisfies: true };
}

/**
 * Per required doc type of a step: how many linked files and live linked
 * documents (in-app invoices) cover it on the same contract/shipment.
 */
export function stepRequirements(required: string[], fileTypes: Iterable<string>, documentTypes: Iterable<string>) {
  const count = (list: Iterable<string>) => {
    const m = new Map<string, number>();
    for (const t of list) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  };
  const f = count(fileTypes);
  const d = count(documentTypes);
  return [...new Set(required)].map((docType) => {
    const files = f.get(docType) ?? 0;
    const documents = d.get(docType) ?? 0;
    return { docType, files, documents, satisfied: files + documents > 0 };
  });
}

/** TradeStep / TradeFileLink invariant: exactly one of contractId / shipmentId. */
export function hasExactlyOneOwner(row: { contractId?: string | null; shipmentId?: string | null }): boolean {
  return !!row.contractId !== !!row.shipmentId;
}

// ── File allow-list ─────────────────────────────────────────────────────────
// MIME types per extension (same idea as leads.service ATTACH_ALLOWED_TYPES).
// Browsers and mail clients often send a generic type for Office/Outlook files
// (Vedanta's .XLS is really tab-delimited text/plain), so a generic type is
// accepted when the extension is on the list.
export const TRADE_FILE_MAX_BYTES = 25 * 1024 * 1024;
const TRADE_FILE_TYPES: Record<string, string[]> = {
  pdf: ['application/pdf'],
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  webp: ['image/webp'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  xls: ['application/vnd.ms-excel'],
  csv: ['text/csv', 'application/vnd.ms-excel'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  doc: ['application/msword'],
  msg: ['application/vnd.ms-outlook'],
  eml: ['message/rfc822'],
};
const GENERIC_MIME = new Set(['', 'application/octet-stream', 'text/plain']);
const ALLOWED_MIME = new Set(Object.values(TRADE_FILE_TYPES).flat());
export const TRADE_FILE_EXTENSIONS = Object.keys(TRADE_FILE_TYPES);

const extOf = (name: string) => {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
};

/**
 * The MIME type to store and serve, or null when the file is not allowed.
 * Allowed: a listed MIME type, or a listed extension with a generic MIME type
 * (then the extension's canonical type is used).
 */
export function resolveTradeFileMime(fileName: string, mimeType: string): string | null {
  const mime = (mimeType || '').toLowerCase();
  const ext = extOf(fileName);
  const forExt = TRADE_FILE_TYPES[ext];
  if (forExt?.includes(mime)) return mime;
  if (forExt && GENERIC_MIME.has(mime)) return forExt[0];
  if (ALLOWED_MIME.has(mime) && !GENERIC_MIME.has(mime)) return mime;
  return null;
}

/** S3-safe file name segment (pattern from document-extraction.controller), extension kept. */
export function sanitizeFileName(name: string): string {
  const clean = (name || 'upload').replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '') || 'upload';
  if (clean.length <= 100) return clean;
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : '';
  return clean.slice(0, 100 - ext.length) + ext;
}

/**
 * Multer decodes multipart file names as latin1, which garbles UTF-8 names
 * (Japanese file names from ADH). Re-decode when the bytes are valid UTF-8.
 */
export function decodeUploadName(name: string): string {
  if (!name || /^[\x00-\x7f]*$/.test(name)) return name;
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('�') ? name : utf8;
}

/**
 * Multipart id lists arrive as an array (repeated `ids[]` fields), a JSON array
 * string, or a comma-separated string.
 */
export function parseIdList(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  let list: unknown[];
  if (Array.isArray(value)) list = value;
  else if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      list = Array.isArray(parsed) ? parsed : [value];
    } catch {
      list = [value];
    }
  } else list = String(value).split(',');
  return [...new Set(list.map((v) => String(v).trim()).filter(Boolean))];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID_RE.test(v);

/**
 * The step a contract/shipment is "on": the first non-ongoing step (by
 * sortOrder) that is not DONE. `position` is its 1-based place among the
 * record's non-ongoing steps. null = every step is done ("Completed").
 */
export function currentStepOf<T extends { code: string; title: string; status: string; isOngoing: boolean; sortOrder: number; displayNo?: string | null }>(
  steps: T[],
): { code: string; title: string; position: number; displayNo: string | null; label: string } | null {
  const counted = steps.filter((s) => !s.isOngoing).sort((a, b) => a.sortOrder - b.sortOrder);
  const i = counted.findIndex((s) => s.status !== 'DONE');
  if (i < 0) return null;
  const s = counted[i];
  return { code: s.code, title: s.title, position: i + 1, displayNo: s.displayNo ?? null, label: stepLabel(s, i + 1) };
}

/**
 * "{displayNo}. {title}" — the org's own step number (ADH: "9. Send arrival
 * notice …"); without one, the position when known, else the bare title.
 */
export function stepLabel(s: { title: string; displayNo?: string | null }, position?: number): string {
  const no = s.displayNo?.trim() || (position ? String(position) : '');
  return no ? `${no}. ${s.title}` : s.title;
}

/** Labels for a whole step list (position fallback counts non-ongoing steps by sortOrder). */
export function stepLabels<T extends { id: string; title: string; isOngoing: boolean; displayNo?: string | null; sortOrder?: number }>(steps: T[]): Map<string, string> {
  const counted = steps.filter((s) => !s.isOngoing).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const out = new Map<string, string>();
  for (const s of steps) {
    const i = counted.indexOf(s);
    out.set(s.id, stepLabel(s, i >= 0 ? i + 1 : undefined));
  }
  return out;
}

const qtyText = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toLocaleString('en-US', { maximumFractionDigits: 3 })} MT` : null;
};

/** "6063 · 300 MT" per product line, comma-joined ("6005 · 50 MT, 6063 · 30 MT"). */
export function linesSummary(lines: Array<{ grade?: string | null; product?: string | null; quantityMt?: unknown; sortOrder?: number }>): string | null {
  const parts = [...lines]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((l) => [l.grade || l.product || null, qtyText(l.quantityMt)].filter(Boolean).join(' · '))
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Short label for one product line: "6063 · 152MM · 30 MT". */
export function lineLabel(l: { grade?: string | null; product?: string | null; sizeSpec?: string | null; quantityMt?: unknown }): string {
  return [l.grade || l.product || null, l.sizeSpec || null, qtyText(l.quantityMt)].filter(Boolean).join(' · ') || 'Product line';
}

/** ADH works in Japan: date defaults are the Tokyo calendar day (UTC+9, no DST), not UTC. */
export const TRADE_TIME_ZONE = 'Asia/Tokyo';
export function tradeToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: TRADE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Deposit = PI amount × percent, rounded to cents; null when either is missing. */
export function depositOf(piAmount: unknown, percent: unknown): number | null {
  if (piAmount === null || piAmount === undefined || piAmount === '' || percent === null || percent === undefined || percent === '') return null;
  const a = Number(piAmount);
  const p = Number(percent);
  if (!Number.isFinite(a) || !Number.isFinite(p)) return null;
  return Math.round(a * p) / 100;
}

// ── Dates: every trade date is in 2000–2100 ─────────────────────────────────
// A date input lets the year run to 5+ digits (a stray keystroke gave
// "72026-08-20", which the PDF then printed as typed). The client clamps the
// inputs; the API refuses such values too.
export const TRADE_YEAR_MIN = 2000;
export const TRADE_YEAR_MAX = 2100;

/**
 * Why a date / month value is not acceptable, or null when it is (blank is
 * fine — the field is optional). Accepts "YYYY-MM-DD", "YYYY-MM" and ISO
 * timestamps; a leading run of digits before the first "-" is the year.
 */
export function tradeDateError(value: unknown, name: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return `${name} must be a date`;
  const m = /^(\d+)-(\d{2})(?:-(\d{2}))?(?:$|T)/.exec(value.trim());
  if (!m) return `${name} must be a date (YYYY-MM-DD)`;
  const year = Number(m[1]);
  if (m[1].length !== 4 || year < TRADE_YEAR_MIN || year > TRADE_YEAR_MAX) return `${name}: the year must be between ${TRADE_YEAR_MIN} and ${TRADE_YEAR_MAX}`;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return `${name} has an invalid month`;
  if (m[3] !== undefined) {
    const day = Number(m[3]);
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day < 1 || day > last) return `${name} has an invalid day`;
  }
  return null;
}

/** Date-valued keys of generated-document headers and rows (all optional). */
const DOC_HEADER_DATE_KEYS = ['date', 'issueDate', 'dueDate', 'plDate', 'analysisDate', 'requestDate', 'invoiceDate', 'lmeMonth'];
const DOC_ROW_DATE_KEYS = ['dueDate', 'shipDate', 'deliveryDate'];

/** Every out-of-range date in a generated document's header / rows ("Line 2 取引年月日 …"). */
export function docDateErrors(header: unknown, rows: unknown): string[] {
  const out: string[] = [];
  const h = (header ?? {}) as Record<string, unknown>;
  for (const k of DOC_HEADER_DATE_KEYS) {
    const e = tradeDateError(h[k], k);
    if (e) out.push(e);
  }
  (Array.isArray(rows) ? rows : []).forEach((r, i) => {
    for (const k of DOC_ROW_DATE_KEYS) {
      const e = tradeDateError((r as Record<string, unknown> | null)?.[k], `row ${i + 1} ${k}`);
      if (e) out.push(e);
    }
  });
  return out;
}
