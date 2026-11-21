/**
 * Round BX (Sayaka, ETA tracking): the "Tracking" list — every open shipment arriving in the next ~21 days, one row
 * each, sorted by ETA, with the ETA history and a "delayed" flag (the ETA moved later than it was first known). The
 * carrier's Track link is the same as on the shipment page (link only, no scraping).
 */
import { carrierOf, type Carrier } from './trade-carrier';
import { etaTrail, type EtaChange } from './trade-alerts';
import { shipmentRef, shipmentTab } from './shipments.rules';

export const TRACKING_DAYS = 21;
/** ETAs this many days in the past still show while the shipment has no arrival / discharge date (late arrivals). */
export const TRACKING_PAST_DAYS = 14;

export interface TrackingSource {
  id: string;
  orderId: string | null;
  seqNo: number | null;
  status: string;
  blNumber: string | null;
  shippingLine: string | null;
  vessel: string | null;
  voyageNo: string | null;
  eta: Date | null;
  etaHistory: unknown;
  actualArrivalDate: Date | null;
  dischargeDate: Date | null;
  tsPort: string | null;
  tsEta: Date | null;
  tsEtd: Date | null;
  arrivingVessel: string | null;
  arrivingVoyageNo: string | null;
  order: { orderNo: number | null; customer?: { name: string } | null } | null;
  customer?: { name: string } | null;
  steps: Array<{ displayNo?: string | null; status: string; isOngoing: boolean; notApplicable?: boolean | null }>;
}

export interface TrackingRow {
  id: string;
  orderId: string | null;
  ref: string;
  customerName: string | null;
  blNumber: string | null;
  vessel: string | null;
  voyageNo: string | null;
  carrier: Carrier | null;
  /** The shipping line as typed when AIMS doesn't know the carrier. */
  shippingLine: string | null;
  eta: string | null;
  /** "8/6 → 8/16 → 8/17". */
  etaTrail: string;
  etaHistory: Array<{ eta: string | null; previous: string | null; at: string; by: string | null; source: string }>;
  /** The first ETA AIMS knew. */
  firstEta: string | null;
  /** Days the ETA is later than the first known ETA (0 when not later). */
  delayDays: number;
  delayed: boolean;
  /** Days from today to the ETA (negative = ETA passed, no arrival yet). */
  daysToEta: number | null;
  tsPort: string | null;
  tsEta: string | null;
  tsEtd: string | null;
  arrivingVessel: string | null;
  arrivingVoyageNo: string | null;
}

const ymd = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

/** YYYY-MM-DD ± n days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The ETA window: from TRACKING_PAST_DAYS ago to `days` ahead (inclusive). */
export function trackingWindow(today: string, days = TRACKING_DAYS): { from: string; to: string } {
  return { from: addDays(today, -TRACKING_PAST_DAYS), to: addDays(today, days) };
}

/** One row; null when the shipment doesn't belong on the list (closed, arrived, cleared, no ETA, outside the window). */
export function trackingRow(s: TrackingSource, today: string, days = TRACKING_DAYS): TrackingRow | null {
  if (s.status !== 'OPEN') return null;
  const eta = ymd(s.eta);
  if (!eta) return null;
  if (s.actualArrivalDate || s.dischargeDate) return null;
  // Cleared (every step up to 10 done) — nothing left to track.
  if (shipmentTab(s, today) === 'delivered') return null;
  const w = trackingWindow(today, days);
  if (eta < w.from || eta > w.to) return null;
  const history = (Array.isArray(s.etaHistory) ? (s.etaHistory as EtaChange[]) : []).filter((h) => h && typeof h === 'object');
  const firstEta = history.length ? (history[0].previous ?? history[0].eta ?? eta) : eta;
  const delayDays = firstEta ? Math.max(0, dayDiff(eta, firstEta)) : 0;
  const carrier = carrierOf(s.blNumber, s.shippingLine);
  return {
    id: s.id,
    orderId: s.orderId,
    ref: shipmentRef(s.order?.orderNo, s.seqNo),
    customerName: s.order?.customer?.name ?? s.customer?.name ?? null,
    blNumber: s.blNumber,
    vessel: s.vessel,
    voyageNo: s.voyageNo,
    carrier,
    shippingLine: carrier ? null : s.shippingLine,
    eta,
    etaTrail: etaTrail(history),
    etaHistory: history.map((h) => ({ eta: h.eta ?? null, previous: h.previous ?? null, at: h.at, by: h.by ?? null, source: h.source })),
    firstEta,
    delayDays,
    delayed: delayDays > 0,
    daysToEta: dayDiff(eta, today),
    tsPort: s.tsPort,
    tsEta: ymd(s.tsEta),
    tsEtd: ymd(s.tsEtd),
    arrivingVessel: s.arrivingVessel,
    arrivingVoyageNo: s.arrivingVoyageNo,
  };
}

/** The list, sorted by ETA (then ref). */
export function trackingBoard(rows: TrackingSource[], today: string, days = TRACKING_DAYS): TrackingRow[] {
  return rows
    .map((s) => trackingRow(s, today, days))
    .filter((r): r is TrackingRow => !!r)
    .sort((a, b) => (a.eta ?? '').localeCompare(b.eta ?? '') || a.ref.localeCompare(b.ref, undefined, { numeric: true }));
}
