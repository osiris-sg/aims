/**
 * Stepped "Schedule a delivery" dialog (Biofuel 2026-11-24; flag
 * enableScheduleWizard).
 *
 * The wizard's point is its second step: a real schedule must be BASED ON a
 * piece of paperwork, so the office can never put a run on the road with
 * nothing behind it. Three things count, and exactly three:
 *
 *   QUOTATION    — an existing confirmed quotation of this customer's. Chosen
 *                  from the list only; quotations are raised IN AIMS, so there
 *                  is nothing to upload (guru 2026-11-24).
 *   SALES_ORDER  — the customer's PO. Chosen from the list, or uploaded and
 *                  read by the extractor, which mints the SALES_ORDER Document
 *                  first (the upload path the dialog already had).
 *   CONTRACT     — a master contract. An uploaded FILE ONLY: it is read for
 *                  auto-fill and kept with the run, but it mints no Document
 *                  and appears in no list. That is why `scheduleSource` is one
 *                  Json column and not three typed pointers — a contract has no
 *                  id to point at.
 *
 * Enforced HERE as well as in the dialog: the rule is the reason the flag
 * exists, and a stale browser tab must not be able to schedule around it.
 * A DRAFT is deliberately exempt — a job regularly arrives before its
 * paperwork does, and the office must still be able to park what they typed
 * rather than lose it (the same reasoning as the Sale Order rule).
 */
export const SCHEDULE_WIZARD_FLAG = 'enableScheduleWizard';

export type ScheduleSourceKind = 'QUOTATION' | 'SALES_ORDER' | 'CONTRACT';

export interface ScheduleSource {
  kind: ScheduleSourceKind;
  /** The Document behind it (quotation / sales order). Absent for a contract. */
  documentId?: string;
  /** Display string: the quotation or sales-order number, or the file name. */
  number?: string;
  /** Master contract only: the uploaded file. */
  fileName?: string;
  fileUrl?: string;
}

const KINDS: ScheduleSourceKind[] = ['QUOTATION', 'SALES_ORDER', 'CONTRACT'];

/**
 * The stored form of what the dialog sent, or null when it sent nothing usable.
 * Deliberately strict about `kind` and lenient about the rest: the display
 * fields are cosmetic, but a run whose source kind is junk tells the office
 * nothing and would pass the gate below.
 */
export function normalizeScheduleSource(raw: unknown): ScheduleSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = String(r.kind ?? '').toUpperCase() as ScheduleSourceKind;
  if (!KINDS.includes(kind)) return null;
  const str = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s ? s : undefined;
  };
  // A document-backed source without a document, or a contract without a file,
  // is not evidence of anything — reject it rather than store a hollow marker.
  const documentId = str(r.documentId);
  const fileUrl = str(r.fileUrl);
  if (kind === 'CONTRACT' ? !fileUrl : !documentId) return null;
  return {
    kind,
    ...(documentId ? { documentId } : {}),
    ...(str(r.number) ? { number: str(r.number)! } : {}),
    ...(str(r.fileName) ? { fileName: str(r.fileName)! } : {}),
    ...(fileUrl ? { fileUrl } : {}),
  };
}

/** True when this org's wizard rule is broken by what was sent. */
export function scheduleSourceMissing(opts: {
  isDraft: boolean;
  wizardOrg: boolean;
  source: ScheduleSource | null;
  /** The run's EXISTING source, on an edit — an edit must not have to re-send it. */
  existing?: unknown;
}): boolean {
  if (opts.isDraft || !opts.wizardOrg) return false;
  if (opts.source) return false;
  return !normalizeScheduleSource(opts.existing);
}

/** The message the office sees. Names all three ways out, in the dialog's order. */
export const SCHEDULE_SOURCE_REQUIRED =
  'A quotation, Sales Order or master contract is required for a scheduled delivery. Save it as a draft if the paperwork has not arrived yet.';
