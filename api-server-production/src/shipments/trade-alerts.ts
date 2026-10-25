/**
 * Alerts and reminders (2026-10, meeting feedback) — pure planning. The
 * service gathers each open record's dates, `planAlerts` says which reminders
 * should exist and when they fall due, and the service reconciles TradeAlert
 * rows by key (a moved ETA re-schedules; a finished task resolves).
 *
 *   TAX_FUNDING   CI received → fund the import tax by ETA − 14 days
 *   AN_EXPECTED   CI received → the Arrival Notice should be in by ETA − 2 days
 *   FREE_TIME     discharge (else ETA) + free days (Wan Hai DET 4 calendar days,
 *                 DEM 10; per shipment) → warn 1 day before free time ends
 *   INVOICE_DUE   a finalized customer invoice not yet paid → its due date
 *                 (round O: not for an invoice whose receipt AIMS never tracked —
 *                 the order was closed, or the receipt step imported "completed
 *                 before AIMS", with no receipt on the step: "imported, payment
 *                 not tracked")
 *   PAYMENT_DUE   a supplier PI deposit not yet paid → its due date
 *   STEP_STUCK    an open step unchanged for N days (setting, default 7)
 */

import { BACKFILL_NOTE, IMPORT_NOTE } from './trade-open-orders';

export interface AlertRules {
  taxFundingDaysBefore: number;
  anDaysBefore: number;
  detFreeDays: number;
  demFreeDays: number;
  freeTimeWarnDaysBefore: number;
  stuckDays: number;
  /** Daily digest e-mail to ADH staff (AIMS users only), at this hour Japan time. */
  digestEnabled: boolean;
  digestHourJst: number;
}

export const DEFAULT_ALERT_RULES: AlertRules = {
  taxFundingDaysBefore: 14,
  anDaysBefore: 2,
  detFreeDays: 4,
  demFreeDays: 10,
  freeTimeWarnDaysBefore: 1,
  stuckDays: 7,
  digestEnabled: true,
  digestHourJst: 8,
};

export function alertRulesOf(stored: unknown): AlertRules {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const int = (v: unknown, d: number, max = 365) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : d);
  return {
    taxFundingDaysBefore: int(s.taxFundingDaysBefore, DEFAULT_ALERT_RULES.taxFundingDaysBefore),
    anDaysBefore: int(s.anDaysBefore, DEFAULT_ALERT_RULES.anDaysBefore),
    detFreeDays: int(s.detFreeDays, DEFAULT_ALERT_RULES.detFreeDays),
    demFreeDays: int(s.demFreeDays, DEFAULT_ALERT_RULES.demFreeDays),
    freeTimeWarnDaysBefore: int(s.freeTimeWarnDaysBefore, DEFAULT_ALERT_RULES.freeTimeWarnDaysBefore),
    stuckDays: int(s.stuckDays, DEFAULT_ALERT_RULES.stuckDays),
    digestEnabled: typeof s.digestEnabled === 'boolean' ? s.digestEnabled : DEFAULT_ALERT_RULES.digestEnabled,
    digestHourJst: int(s.digestHourJst, DEFAULT_ALERT_RULES.digestHourJst, 23),
  };
}

/** Validate an alert-rules patch (whole numbers of days ≥ 0; digest on / off, hour 0–23). */
export function cleanAlertRules(v: Record<string, unknown>, fail: (msg: string) => never): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v ?? {})) {
    if (!(k in DEFAULT_ALERT_RULES)) fail(`Unknown alert rule "${k}"`);
    if (k === 'digestEnabled') {
      if (typeof x !== 'boolean') fail('digestEnabled must be true or false');
      out[k] = x;
      continue;
    }
    const max = k === 'digestHourJst' ? 23 : 365;
    if (typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x > max) fail(`${k} must be a whole number from 0 to ${max}`);
    out[k] = x;
  }
  return out;
}

export type AlertKind = 'TAX_FUNDING' | 'AN_EXPECTED' | 'FREE_TIME' | 'INVOICE_DUE' | 'PAYMENT_DUE' | 'STEP_STUCK' | 'CUSTOM' | 'LME_REVISE';
/** Round T: a reminder a person set ("remind me tomorrow 9am to chase Vedanta") — the sweep never plans or closes these. */
export const CUSTOM_KIND: AlertKind = 'CUSTOM';
/** Round AK: tasks raised by an event (an LME month turned final) — like CUSTOM, the hourly planner never closes them. */
export const STANDING_KINDS: ReadonlySet<string> = new Set<string>(['CUSTOM', 'LME_REVISE']);

export interface PlannedAlert {
  key: string;
  kind: AlertKind;
  dueAt: Date;
  title: string;
  detail: string | null;
  shipmentId?: string | null;
  orderId?: string | null;
  supplierOrderId?: string | null;
  linkUrl: string | null;
  /** The task is done (or no longer applies): the alert is closed. */
  resolved: boolean;
}

export interface ShipmentFacts {
  id: string;
  ref: string;
  orderId: string | null;
  status: string;
  eta: Date | null;
  dischargeDate: Date | null;
  detFreeDays: number | null;
  demFreeDays: number | null;
  /** A CI is on the shipment (step 3b / 6). */
  hasCi: boolean;
  /** An Arrival Notice is on the shipment. */
  hasAn: boolean;
  /** Step 8 done, or funds recorded. */
  taxFunded: boolean;
  /** The goods left the port (step 9 done / delivered / shipment completed). */
  cleared: boolean;
}

export interface InvoiceFacts {
  id: string;
  number: string;
  customerName: string | null;
  dueDate: Date | null;
  total: number;
  paid: number;
  currency: string;
  orderId: string | null;
  shipmentId: string | null;
  /** Round O: the receipt was never going to be recorded in AIMS (see receiptNotTracked) — no reminder. */
  imported?: boolean;
}

export const NOT_TRACKED_NOTE = 'Imported, payment not tracked.';

/**
 * Round O: an invoice whose receipt AIMS never tracked — the order is closed
 * (completed / cancelled, i.e. history keyed in after the fact) or its receipt
 * step was imported "completed before AIMS" — and nothing was received on the
 * step. Such an invoice raises no "outstanding" reminder; the step reads
 * "Imported, payment not tracked" instead. A receipt recorded on the step, or an
 * open order, means the money IS tracked and the normal due-date rule applies.
 * Round AB: a step the SUS backfill marked done ("Backfilled from price log, no document…") counts the same way.
 */
export function receiptNotTracked(i: { orderStatus: string | null | undefined; stepSkipReason: string | null | undefined; paid: number }, importNote: string = IMPORT_NOTE): boolean {
  if (i.paid > 0) return false;
  if (i.orderStatus && i.orderStatus !== 'OPEN') return true;
  const note = i.stepSkipReason ?? '';
  return note === importNote || note.startsWith(BACKFILL_NOTE);
}

export interface DepositFacts {
  /** The order (round H: the PI and its deposit are on the order). */
  orderId: string;
  label: string;
  dueDate: Date | null;
  paid: boolean;
}

export interface StepFacts {
  id: string;
  label: string;
  recordRef: string;
  updatedAt: Date;
  shipmentId: string | null;
  orderId: string | null;
  supplierOrderId: string | null;
}

const DAY = 86_400_000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
/** Midnight UTC of the day (alerts fall due at the start of their day). */
const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const orderLink = (orderId: string | null | undefined, shipmentId?: string | null) =>
  orderId ? `/portal/shipments/orders/${orderId}${shipmentId ? `?shipment=${shipmentId}` : ''}` : null;

export function planShipmentAlerts(s: ShipmentFacts, rules: AlertRules): PlannedAlert[] {
  const out: PlannedAlert[] = [];
  const closed = s.status !== 'OPEN';
  const link = orderLink(s.orderId, s.id);
  if (s.eta && s.hasCi) {
    const eta = day(s.eta);
    out.push({
      key: `TAX_FUNDING:${s.id}`,
      kind: 'TAX_FUNDING',
      dueAt: addDays(eta, -rules.taxFundingDaysBefore),
      title: `${s.ref}: fund the import tax (ETA ${ymd(eta)})`,
      detail: `Import-tax funds should be ready ${rules.taxFundingDaysBefore} days before arrival (step 8).`,
      shipmentId: s.id,
      orderId: s.orderId,
      linkUrl: link,
      resolved: closed || s.taxFunded,
    });
    out.push({
      key: `AN_EXPECTED:${s.id}`,
      kind: 'AN_EXPECTED',
      dueAt: addDays(eta, -rules.anDaysBefore),
      title: `${s.ref}: Arrival Notice expected (ETA ${ymd(eta)})`,
      detail: `Wan Hai sends the A/N about ${rules.anDaysBefore} days before arrival — upload it on step 9.`,
      shipmentId: s.id,
      orderId: s.orderId,
      linkUrl: link,
      resolved: closed || s.hasAn,
    });
  }
  const start = s.dischargeDate ?? s.eta;
  if (start) {
    const det = s.detFreeDays ?? rules.detFreeDays;
    const dem = s.demFreeDays ?? rules.demFreeDays;
    for (const [code, days] of [
      ['DET', det],
      ['DEM', dem],
    ] as Array<[string, number]>) {
      const ends = addDays(day(start), days);
      out.push({
        key: `FREE_TIME:${code}:${s.id}`,
        kind: 'FREE_TIME',
        dueAt: addDays(ends, -rules.freeTimeWarnDaysBefore),
        title: `${s.ref}: ${code === 'DET' ? 'detention' : 'demurrage'} free time ends ${ymd(ends)}`,
        detail: `${code} ${days} days from ${s.dischargeDate ? 'discharge' : 'ETA'} ${ymd(day(start))}.`,
        shipmentId: s.id,
        orderId: s.orderId,
        linkUrl: link,
        resolved: closed || s.cleared,
      });
    }
  }
  return out;
}

export function planInvoiceAlert(i: InvoiceFacts): PlannedAlert | null {
  if (!i.dueDate) return null;
  const open = Math.round((i.total - i.paid) * 100) / 100;
  return {
    key: `INVOICE_DUE:${i.id}`,
    kind: 'INVOICE_DUE',
    dueAt: day(i.dueDate),
    title: `Invoice ${i.number}${i.customerName ? ` (${i.customerName})` : ''} due ${ymd(day(i.dueDate))}`,
    detail: i.imported ? NOT_TRACKED_NOTE : `${i.currency} ${open.toLocaleString('en-US', { minimumFractionDigits: 2 })} outstanding.`,
    orderId: i.orderId,
    shipmentId: i.shipmentId,
    linkUrl: orderLink(i.orderId, i.shipmentId),
    // Round O: an imported invoice (receipt never tracked) is closed, never raised.
    resolved: open <= 0.004 || !!i.imported,
  };
}

export function planDepositAlert(d: DepositFacts): PlannedAlert | null {
  if (!d.dueDate) return null;
  return {
    key: `PAYMENT_DUE:PI:${d.orderId}`,
    kind: 'PAYMENT_DUE',
    dueAt: day(d.dueDate),
    title: `${d.label}: deposit due ${ymd(day(d.dueDate))}`,
    detail: 'Pay the PI deposit (step 1).',
    orderId: d.orderId,
    linkUrl: orderLink(d.orderId),
    resolved: d.paid,
  };
}

export function planStuckAlert(s: StepFacts, rules: AlertRules, now: Date): PlannedAlert | null {
  if (!rules.stuckDays) return null;
  const due = addDays(day(s.updatedAt), rules.stuckDays);
  if (due.getTime() > now.getTime()) return null;
  return {
    key: `STEP_STUCK:${s.id}`,
    kind: 'STEP_STUCK',
    dueAt: due,
    title: `${s.recordRef}: "${s.label}" unchanged for ${rules.stuckDays}+ days`,
    detail: `Last change ${ymd(s.updatedAt)}.`,
    shipmentId: s.shipmentId,
    orderId: s.orderId,
    supplierOrderId: s.supplierOrderId,
    linkUrl: s.supplierOrderId ? `/portal/shipments/supplier-orders/${s.supplierOrderId}` : orderLink(s.orderId, s.shipmentId),
    resolved: false,
  };
}

/** How the stored row changes for a planned alert: create, re-schedule (date / text moved), resolve, or leave. */
export function reconcileAlert(
  cur: { dueAt: Date; status: string; title: string } | null,
  next: PlannedAlert,
  now: Date,
): { action: 'create' | 'update' | 'none'; status: string; resetNotified: boolean } {
  const want = next.resolved ? 'DONE' : next.dueAt.getTime() <= now.getTime() ? 'DUE' : 'SCHEDULED';
  if (!cur) return { action: next.resolved ? 'none' : 'create', status: want, resetNotified: false };
  if (cur.status === 'DISMISSED' && cur.dueAt.getTime() === next.dueAt.getTime()) return { action: 'none', status: cur.status, resetNotified: false };
  const moved = cur.dueAt.getTime() !== next.dueAt.getTime();
  // A moved date re-opens a dismissed reminder and lets it notify again.
  if (moved || cur.status !== want || cur.title !== next.title) return { action: 'update', status: want, resetNotified: moved };
  return { action: 'none', status: cur.status, resetNotified: false };
}

/** ETA history entry: "8/6 → 8/16 → 8/17". */
export interface EtaChange {
  eta: string | null;
  previous: string | null;
  at: string;
  by: string | null;
  source: string;
}

/** Append an ETA change to the history (nothing when the date didn't move). */
export function withEtaChange(history: unknown, previous: Date | null, next: Date | null, by: string | null, source: string, at = new Date()): EtaChange[] {
  const list = Array.isArray(history) ? (history as EtaChange[]) : [];
  const p = previous ? ymd(previous) : null;
  const n = next ? ymd(next) : null;
  if (p === n) return list;
  return [...list, { eta: n, previous: p, at: at.toISOString(), by, source }];
}

/** "8/6 → 8/16 → 8/17" from the history (first previous, then every new ETA). */
export function etaTrail(history: unknown): string {
  const list = Array.isArray(history) ? (history as EtaChange[]) : [];
  if (!list.length) return '';
  const md = (s: string | null) => (s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : '—');
  const parts = [list[0].previous ? md(list[0].previous) : null, ...list.map((h) => md(h.eta))].filter((x): x is string => !!x);
  return parts.join(' → ');
}
