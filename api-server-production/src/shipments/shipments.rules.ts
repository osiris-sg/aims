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
  /** "N/A (customer profile)": never blocks, never counted, never auto-completed. */
  notApplicable?: boolean | null;
}

/** A step that counts toward progress / completion: not ongoing and not N/A for the customer. */
export const countsForProgress = (s: { isOngoing: boolean; notApplicable?: boolean | null }) => !s.isOngoing && !s.notApplicable;

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
  return steps.filter((s) => countsForProgress(s) && s.status !== 'DONE');
}

/**
 * DONE steps that would be left missing a required doc type once only the doc
 * types in `presentAfter` remain linked to their contract/shipment.
 */
export function stepsBrokenByRemoval<T extends StepLike>(steps: T[], presentAfter: Iterable<string>): Array<{ step: T; missing: string[] }> {
  const have = new Set(presentAfter);
  return steps
    .filter((s) => s.status === 'DONE' && !s.notApplicable)
    .map((step) => ({ step, missing: missingDocTypes(step.requiredDocTypes, have) }))
    .filter((r) => r.missing.length > 0);
}

/** {done,total} over non-ongoing steps; only DONE counts. */
export function progressOf(steps: Array<{ status: string; isOngoing: boolean; notApplicable?: boolean | null }>): { done: number; total: number } {
  const counted = steps.filter(countsForProgress);
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

/** TradeStep / TradeFileLink invariant: exactly one of contractId / shipmentId / orderId. */
export function hasExactlyOneOwner(row: { contractId?: string | null; shipmentId?: string | null; orderId?: string | null; supplierOrderId?: string | null }): boolean {
  return [row.contractId, row.shipmentId, row.orderId, row.supplierOrderId].filter(Boolean).length === 1;
}

/** A supplier order's label: its PI no. when known ("PI 9331004128"), else "S3". */
export const supplierOrderLabel = (so: { soNo: number; piNo?: string | null } | null | undefined) => (so ? (so.piNo ? `PI ${so.piNo}` : `S${so.soNo}`) : '');

// ── Orders ("#19") and shipments under them ("#19-1") ──────────────────────
/** "#19" — how ADH names an order. */
export const orderLabel = (o: { orderNo: number | null | undefined } | null | undefined) => (o?.orderNo ? `#${o.orderNo}` : '');
/** "#19-1" — shipment 1 of order #19; "" without an order; "#19" when the shipment has no number yet. */
export const shipmentRef = (orderNo: number | null | undefined, seqNo: number | null | undefined) => (orderNo ? (seqNo ? `#${orderNo}-${seqNo}` : `#${orderNo}`) : '');
/** "Sep 26" for "2026-09" (the task list's month labels). */
export function monthShort(month: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  if (!m) return '';
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]} ${m[1].slice(2)}`;
}
/** "Sep 26 → Nov 26". */
export const monthsLabel = (ship: string | null | undefined, delivery: string | null | undefined) => [monthShort(ship), monthShort(delivery)].filter(Boolean).join(' → ');

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
export function currentStepOf<T extends { code: string; title: string; status: string; isOngoing: boolean; sortOrder: number; displayNo?: string | null; notApplicable?: boolean | null }>(
  steps: T[],
): { code: string; title: string; position: number; displayNo: string | null; label: string } | null {
  const counted = steps.filter(countsForProgress).sort((a, b) => a.sortOrder - b.sortOrder);
  const i = counted.findIndex((s) => s.status !== 'DONE');
  if (i < 0) return null;
  const s = counted[i];
  return { code: s.code, title: s.title, position: i + 1, displayNo: s.displayNo ?? null, label: stepLabel(s, i + 1) };
}

type StepRow = Parameters<typeof currentStepOf>[0][number];
export type CurrentStep = NonNullable<ReturnType<typeof currentStepOf>>;
const stepNo = (s: CurrentStep) => Number(/^(\d+)/.exec(s.displayNo ?? '')?.[1] ?? 99);
/** Shown for an order whose open steps all wait for a shipment (Kato before its B/L: step 2 N/A, 3a–12 not there yet). */
export const AWAITING_SHIPMENT: CurrentStep = { code: 'AWAITING_SHIPMENT', title: 'Awaiting shipment', position: 0, displayNo: null, label: 'Awaiting shipment' };

/**
 * An order's current step: the lowest-numbered open step of its supplier order
 * (0 / 1), its own steps (2, 13) and its first open shipment (3a–12) — an order
 * whose Invoice #1 is done is at its shipment's step, not at 13. Before any
 * shipment exists, 13 isn't "current": the order is "Awaiting shipment".
 */
export function orderCurrentStep(supplierSteps: StepRow[] | null, orderSteps: StepRow[], shipments: Array<{ status: string; steps: StepRow[] }>): CurrentStep | null {
  const live = shipments.filter((s) => s.status !== 'CANCELLED');
  const shipStep = live.filter((s) => s.status === 'OPEN').map((s) => currentStepOf(s.steps)).find(Boolean) ?? null;
  const cands = [supplierSteps ? currentStepOf(supplierSteps) : null, currentStepOf(orderSteps), shipStep].filter((x): x is CurrentStep => !!x).sort((a, b) => stepNo(a) - stepNo(b));
  if (!live.length) {
    const early = cands.find((c) => stepNo(c) <= 2);
    if (early) return early;
    return cands.length ? AWAITING_SHIPMENT : null;
  }
  return cands[0] ?? null;
}

/**
 * "{displayNo}. {title}" — the org's own step number (ADH: "9. Send arrival
 * notice …"); without one, the position when known, else the bare title.
 */
export function stepLabel(s: { title: string; displayNo?: string | null }, position?: number): string {
  const no = s.displayNo?.trim() || (position ? String(position) : '');
  return no ? `${no}. ${s.title}` : s.title;
}

/** Step 11 on the order (round H): the invoice types it can be satisfied by from its shipments. */
export const ORDER_INVOICE_TYPES = ['INVOICE_2', 'INVOICE_SINGLE'];

/**
 * The doc types (of `types`) present on EVERY one of the order's live
 * shipments — step 11 lives on the order but Invoice #2 / the single invoice
 * is filed per shipment, so the order counts it once each shipment has one.
 * No live shipment → nothing.
 */
export function typesOnEveryShipment(shipmentIds: string[], present: Array<{ shipmentId: string | null; docType: string }>, types: string[] = ORDER_INVOICE_TYPES): string[] {
  if (!shipmentIds.length) return [];
  return types.filter((t) => shipmentIds.every((id) => present.some((p) => p.shipmentId === id && p.docType === t)));
}

/** Labels for a whole step list (position fallback counts non-ongoing steps by sortOrder). */
export function stepLabels<T extends { id: string; title: string; isOngoing: boolean; displayNo?: string | null; sortOrder?: number; notApplicable?: boolean | null }>(steps: T[]): Map<string, string> {
  const counted = steps.filter(countsForProgress).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
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

// ── Auto-complete ───────────────────────────────────────────────────────────
// A step completes by itself once every required document type is present on
// its record and every required record field is filled. Steps with nothing
// required (ADH 5, 8, 13) are "Mark done" by hand; ongoing steps never
// complete. A step reopened by hand (holdOpen) waits until one of its own
// documents / fields changes, so "Reopen" can be used to replace a file.

/** Field names a step can require, with the label shown in "Still needed". */
export const STEP_FIELD_LABELS: Record<string, string> = {
  blNumber: 'B/L no.',
  contractLineId: 'Product line',
  vessel: 'Vessel',
  voyageNo: 'Voyage no.',
  etd: 'ETD',
  eta: 'Latest ETA',
  netWeightMt: 'Net weight',
  grossWeightMt: 'Gross weight',
  totalBundles: 'Bundles',
  portOfLoading: 'Port of loading',
  portOfDischarge: 'Port of discharge',
  telexReleaseCode: 'Telex release code',
  depositPaidAt: 'Deposit paid on',
};
export const fieldLabel = (f: string) => STEP_FIELD_LABELS[f] ?? f;

const filled = (v: unknown) => v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '');

/** Per required field: filled on the record or not. */
export function fieldRequirements(required: string[] | null | undefined, record: Record<string, unknown> | null | undefined) {
  return [...new Set(required ?? [])].map((field) => ({ field, label: fieldLabel(field), satisfied: filled(record?.[field]) }));
}

export interface AutoStep {
  id: string;
  status: string;
  isOngoing: boolean;
  sortOrder: number;
  requiredDocTypes: string[];
  requiredFields?: string[] | null;
  holdOpen?: boolean | null;
  notApplicable?: boolean | null;
}

/** Something to tick: at least one required document type or field. */
export const hasRequirements = (s: Pick<AutoStep, 'requiredDocTypes' | 'requiredFields'>) => s.requiredDocTypes.length > 0 || (s.requiredFields?.length ?? 0) > 0;

/** Everything the step requires is there (doc types present, fields filled). */
export function stepSatisfied(s: Pick<AutoStep, 'requiredDocTypes' | 'requiredFields'>, present: Iterable<string>, record: Record<string, unknown> | null | undefined): boolean {
  return missingDocTypes(s.requiredDocTypes, present).length === 0 && fieldRequirements(s.requiredFields, record).every((f) => f.satisfied);
}

/**
 * What auto-complete does to a record's steps: which to mark DONE, which holds
 * to release (a changed doc type / field the held step requires), and which
 * step becomes the current one (IN_PROGRESS when it was NOT_STARTED).
 */
export function autoCompletePlan<T extends AutoStep>(
  steps: T[],
  present: Iterable<string>,
  record: Record<string, unknown> | null | undefined,
  changed: { docTypes?: string[]; fields?: string[] } = {},
): { complete: T[]; release: T[]; start: T | null } {
  const have = [...present];
  const touched = (s: T) => s.requiredDocTypes.some((d) => changed.docTypes?.includes(d)) || (s.requiredFields ?? []).some((f) => changed.fields?.includes(f));
  const release = steps.filter((s) => s.holdOpen && touched(s));
  const held = (s: T) => !!s.holdOpen && !release.includes(s);
  const complete = steps.filter((s) => countsForProgress(s) && s.status !== 'DONE' && !held(s) && hasRequirements(s) && stepSatisfied(s, have, record));
  const after = (s: T) => (complete.includes(s) ? 'DONE' : s.status);
  const next = steps
    .filter(countsForProgress)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .find((s) => after(s) !== 'DONE');
  return { complete, release, start: next && next.status === 'NOT_STARTED' ? next : null };
}

// ── Shipments list (2026-10, round H): every B/L across all orders ─────────
export type ShipmentTab = 'in_transit' | 'arrived' | 'delivered' | 'completed';
export const SHIPMENT_TABS: ShipmentTab[] = ['in_transit', 'arrived', 'delivered', 'completed'];

/**
 * Which tab a shipment is in: completed (or cancelled) → Completed; every open
 * step up to 10 (import permit) done → Delivered (cleared, only 12 / 14 left);
 * arrived (arrival / discharge date, or the latest ETA has passed) → Arrived;
 * else In transit.
 */
export function shipmentTab(
  s: { status: string; actualArrivalDate?: Date | string | null; dischargeDate?: Date | string | null; eta?: Date | string | null; steps: Array<{ displayNo?: string | null; status: string; isOngoing: boolean; notApplicable?: boolean | null }> },
  today: string,
): ShipmentTab {
  if (s.status !== 'OPEN') return 'completed';
  const counted = s.steps.filter((x) => countsForProgress(x) && /^\d+/.test(x.displayNo ?? ''));
  const upTo10 = counted.filter((x) => Number(/^(\d+)/.exec(x.displayNo ?? '')![1]) <= 10);
  if (upTo10.length && upTo10.every((x) => x.status === 'DONE')) return 'delivered';
  const ymd = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);
  const eta = ymd(s.eta);
  if (s.actualArrivalDate || s.dischargeDate || (eta && eta <= today)) return 'arrived';
  return 'in_transit';
}

/**
 * Free time left at the port (DET / DEM) from the discharge date (else the
 * latest ETA): days until each ends (negative = over). null when there is no
 * date, or the shipment is past the port (delivered / completed).
 */
export function freeTimeLeft(
  s: { dischargeDate?: Date | string | null; eta?: Date | string | null; detFreeDays?: number | null; demFreeDays?: number | null },
  rules: { detFreeDays: number; demFreeDays: number },
  today: string,
): { from: 'discharge' | 'eta'; det: { ends: string; daysLeft: number }; dem: { ends: string; daysLeft: number } } | null {
  const start = s.dischargeDate ?? s.eta;
  if (!start) return null;
  const d0 = Date.parse(new Date(start).toISOString().slice(0, 10));
  const t = Date.parse(today);
  const one = (days: number) => {
    const ends = d0 + days * 86_400_000;
    return { ends: new Date(ends).toISOString().slice(0, 10), daysLeft: Math.round((ends - t) / 86_400_000) };
  };
  return { from: s.dischargeDate ? 'discharge' : 'eta', det: one(s.detFreeDays ?? rules.detFreeDays), dem: one(s.demFreeDays ?? rules.demFreeDays) };
}
