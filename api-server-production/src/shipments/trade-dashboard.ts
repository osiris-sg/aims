/**
 * The pipeline grid (2026-10, management view) in the shape of ADH's Excel:
 * per delivery month, columns = orders (#n), rows = steps 0–14, each cell
 * done / in progress / N/A / overdue / not started (or blank when the order
 * has no such step). An order's cell for a shipment step sums its shipments
 * (#n-1, #n-2): done only when all are. Pure.
 */

export type CellState = 'done' | 'in_progress' | 'na' | 'overdue' | 'not_started' | 'none';

export interface StepLike {
  displayNo: string | null;
  code: string;
  title: string;
  status: string;
  notApplicable: boolean;
  isOngoing: boolean;
}

export interface PipelineOrder {
  id: string;
  label: string;
  deliveryMonth: string | null;
  customerName: string | null;
  status: string;
  /** Steps of the supplier order (0, 1), the order (2, 13) and every shipment (3a–12, 14). */
  steps: Array<StepLike & { recordId: string }>;
  /** Records (order / shipments / supplier order) with an alert past due. */
  overdueRecords: Set<string>;
}

export const PIPELINE_ROWS = ['0', '1', '2', '3a', '3b', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14'];

/** One cell: the steps of that number across the order's records. */
export function cellState(steps: Array<StepLike & { recordId: string }>, overdueRecords: Set<string>): CellState {
  if (!steps.length) return 'none';
  const live = steps.filter((s) => !s.notApplicable);
  if (!live.length) return 'na';
  if (live.every((s) => s.status === 'DONE')) return 'done';
  // Overdue: the step being worked on (IN_PROGRESS) of a record with a past-due alert.
  if (live.some((s) => s.status === 'IN_PROGRESS' && overdueRecords.has(s.recordId))) return 'overdue';
  if (live.some((s) => s.status === 'IN_PROGRESS' || s.status === 'DONE')) return 'in_progress';
  return 'not_started';
}

export interface PipelineMonth {
  month: string | null;
  orders: Array<{ id: string; label: string; customerName: string | null; status: string; cells: Record<string, CellState> }>;
}

/** Steps 3a / 3b keep their letter; anything else by its number. */
const rowOf = (s: StepLike) => (s.displayNo ?? '').trim();

export function pipelineGrid(orders: PipelineOrder[]): { rows: Array<{ no: string; title: string }>; months: PipelineMonth[] } {
  const titles = new Map<string, string>();
  const byMonth = new Map<string | null, PipelineMonth>();
  for (const o of orders) {
    const cells: Record<string, CellState> = {};
    for (const no of PIPELINE_ROWS) {
      const steps = o.steps.filter((s) => rowOf(s) === no);
      for (const s of steps) if (!titles.has(no)) titles.set(no, s.title);
      cells[no] = cellState(steps, o.overdueRecords);
    }
    const m = byMonth.get(o.deliveryMonth) ?? { month: o.deliveryMonth, orders: [] };
    m.orders.push({ id: o.id, label: o.label, customerName: o.customerName, status: o.status, cells });
    byMonth.set(o.deliveryMonth, m);
  }
  const months = [...byMonth.values()].sort((a, b) => (a.month ?? '9999').localeCompare(b.month ?? '9999'));
  return { rows: PIPELINE_ROWS.map((no) => ({ no, title: titles.get(no) ?? '' })), months };
}

/**
 * The Orders list's progress bar (round K): one segment per applicable step, in step order — N/A and
 * ongoing steps hidden — coloured like the pipeline grid (cellState). A step that exists on several
 * records (an order with shipments #19-1, #19-2) is one segment, done only when all are. Pure.
 */
export type SegmentState = 'done' | 'in_progress' | 'overdue' | 'not_started';
export interface ProgressSegment {
  no: string;
  title: string;
  state: SegmentState;
}
export interface ProgressBar {
  segments: ProgressSegment[];
  done: number;
  total: number;
}

type SegStep = StepLike & { recordId: string; sortOrder?: number | null };
const segKey = (s: StepLike) => (s.displayNo ?? '').trim() || s.code;
/** "3a" → [3, "a"]; no number → after the numbered ones. */
const segRank = (no: string): [number, string] => {
  const m = /^(\d+)([a-z]*)/i.exec(no);
  return m ? [Number(m[1]), m[2].toLowerCase()] : [Number.MAX_SAFE_INTEGER, no];
};

export function progressBar(steps: SegStep[], overdueRecords: Set<string>): ProgressBar {
  const groups = new Map<string, { steps: SegStep[]; minSort: number }>();
  for (const s of steps) {
    if (s.isOngoing) continue;
    const k = segKey(s);
    const g = groups.get(k) ?? { steps: [], minSort: Number.MAX_SAFE_INTEGER };
    g.steps.push(s);
    g.minSort = Math.min(g.minSort, s.sortOrder ?? Number.MAX_SAFE_INTEGER);
    groups.set(k, g);
  }
  const segments: ProgressSegment[] = [];
  const ordered = [...groups.entries()].sort(([a, ga], [b, gb]) => {
    const [na, la] = segRank(a);
    const [nb, lb] = segRank(b);
    return na - nb || la.localeCompare(lb) || ga.minSort - gb.minSort;
  });
  for (const [no, g] of ordered) {
    const state = cellState(g.steps, overdueRecords);
    if (state === 'na' || state === 'none') continue;
    segments.push({ no: /^\d/.test(no) ? no : '', title: g.steps[0].title, state });
  }
  return { segments, done: segments.filter((x) => x.state === 'done').length, total: segments.length };
}

/** "Step 7 · Customs documents & tax estimate" (the step's own number when it has one). */
export function stepBarLabel(step: { title: string; displayNo?: string | null } | null): string | null {
  if (!step) return null;
  return step.displayNo ? `Step ${step.displayNo} · ${step.title}` : step.title;
}

/** Cash by month: { "2026-07": { in: { USD: 1 }, out: { USD: 2, JPY: 3 } } }. */
export function cashByMonth(payments: Array<{ direction: string; paidAt: Date; currency: string; amount: number }>) {
  const out: Record<string, { in: Record<string, number>; out: Record<string, number> }> = {};
  for (const p of payments) {
    const m = p.paidAt.toISOString().slice(0, 7);
    const slot = (out[m] ??= { in: {}, out: {} });
    const side = p.direction === 'IN' ? slot.in : slot.out;
    side[p.currency] = Math.round(((side[p.currency] ?? 0) + p.amount) * 100) / 100;
  }
  return out;
}

/**
 * ADH's margin on an order (USD): margin per MT × quantity. The contract's
 * schedule gives the per-MT margin (client − supplier fixed premiums — the MJP
 * cancels out); without one, the order's own premiums (+ upcharge).
 */
export function orderMargin(o: { clientPremium: unknown; supplierPremium: unknown; upcharge?: unknown; qtyMt: unknown }, scheduleMarginPerMt?: number | null): number | null {
  const q = o.qtyMt === null || o.qtyMt === undefined ? null : Number(o.qtyMt);
  if (q === null) return null;
  if (scheduleMarginPerMt !== null && scheduleMarginPerMt !== undefined) return Math.round((scheduleMarginPerMt + (Number(o.upcharge) || 0)) * q * 100) / 100;
  const c = o.clientPremium === null || o.clientPremium === undefined ? null : Number(o.clientPremium);
  const s = o.supplierPremium === null || o.supplierPremium === undefined ? null : Number(o.supplierPremium);
  if (c === null || s === null) return null;
  return Math.round((c + (Number(o.upcharge) || 0) - s) * q * 100) / 100;
}
