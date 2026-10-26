/**
 * Import of ADH's open orders from their task list (2026-10): the pure parts
 * (scripts/import-open-orders.ts does the writes). The file is hand-cleaned
 * customer business data and stays out of the repo:
 *   { year, supplier, orders: [{ orderNo, customer, contract, grade, size, qtyMt, shipMonth, deliveryMonth,
 *     clientFixedPremium, currentStep, note, shipments: [{ seq, blNo, vesselVoyage, carrier, netMt, grossMt, etd, eta, arrived }] }] }
 */

export interface OpenOrderShipment {
  seq: number;
  blNo: string;
  vesselVoyage?: string | null;
  carrier?: string | null;
  netMt?: number | null;
  grossMt?: number | null;
  etd?: string | null;
  eta?: string | null;
  arrived?: string | null;
}

export interface OpenOrder {
  orderNo: number;
  customer: string;
  contract: string;
  grade: string;
  size?: string | null;
  qtyMt: number;
  shipMonth: string;
  deliveryMonth: string;
  /** The client's fixed premium (USD/MT); null = not on the task list → "check". */
  clientFixedPremium: number | null;
  /** The step ADH is on (ADH's numbering: 0–14; 3 = 3a / 3b). */
  currentStep: number;
  note?: string | null;
  shipments?: OpenOrderShipment[];
}

export interface OpenOrdersFile {
  year: number;
  supplier: string;
  orders: OpenOrder[];
}

/** Task-list customer → the org's customer name. */
export const CUSTOMER_NAMES: Record<string, string> = {
  SUS: 'SUS Co., Ltd.',
  KATO: 'Kato Light Metal Industry Co., Ltd.',
  HOEI: 'Houei',
};

/** Task-list carrier code → the shipping line printed on the shipment (carrierOf() reads it back). */
export const CARRIER_LINES: Record<string, string> = {
  WANHAI: 'WAN HAI LINES',
  SITC: 'SITC',
  RCL: 'RCL',
  MAERSK: 'MAERSK',
  MSC: 'MSC',
  EVERGREEN: 'EVERGREEN',
  KMTC: 'KMTC',
};

/** The import's note on every step it marks done. */
export const IMPORT_NOTE = 'completed before AIMS (from task list)';
/** Round AB: the SUS backfill's note on every step it marks done (the step may carry a figure after it: "… · Invoice #1 ≈ USD …"). */
export const BACKFILL_NOTE = 'Backfilled from price log, no document';
/** Round AO: past deals created from ADH's Drive (orders #30–#40, #9-1, split shipments) — history, never chased. */
export const DRIVE_BACKFILL_NOTE = 'Backfilled from Drive';
/** Already in AIMS before the import (order #11): never touched. */
export const SKIP_ORDERS = new Set([11]);

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Shape errors in the file ([] = fine). */
export function openOrdersProblems(f: unknown): string[] {
  const out: string[] = [];
  const x = f as OpenOrdersFile;
  if (!x || typeof x !== 'object' || !Array.isArray(x.orders)) return ['the file needs { year, supplier, orders: [] }'];
  if (!Number.isInteger(x.year)) out.push('year must be a number');
  const seen = new Set<number>();
  const bls = new Set<string>();
  for (const o of x.orders) {
    const at = `#${o?.orderNo ?? '?'}`;
    if (!Number.isInteger(o?.orderNo) || o.orderNo < 1) out.push(`${at}: orderNo`);
    if (seen.has(o.orderNo)) out.push(`${at}: listed twice`);
    seen.add(o.orderNo);
    if (!CUSTOMER_NAMES[String(o.customer ?? '').toUpperCase()]) out.push(`${at}: unknown customer "${o.customer}"`);
    if (!/^4540\d{5}$/.test(String(o.contract ?? ''))) out.push(`${at}: contract "${o.contract}"`);
    if (!MONTH.test(o.shipMonth ?? '') || !MONTH.test(o.deliveryMonth ?? '')) out.push(`${at}: ship / delivery month`);
    if (!(Number(o.qtyMt) > 0)) out.push(`${at}: qtyMt`);
    if (o.clientFixedPremium !== null && !Number.isFinite(o.clientFixedPremium)) out.push(`${at}: clientFixedPremium`);
    if (!Number.isInteger(o.currentStep) || o.currentStep < 0 || o.currentStep > 14) out.push(`${at}: currentStep 0–14`);
    for (const s of o.shipments ?? []) {
      if (!s?.blNo) out.push(`${at}: a shipment without a B/L`);
      else if (bls.has(s.blNo)) out.push(`${at}: B/L ${s.blNo} listed twice`);
      else bls.add(s.blNo);
      for (const k of ['etd', 'eta', 'arrived'] as const) if (s[k] && !DAY.test(s[k]!)) out.push(`${at}-${s.seq}: ${k} "${s[k]}"`);
      if (s.carrier && !CARRIER_LINES[s.carrier.toUpperCase()]) out.push(`${at}-${s.seq}: unknown carrier "${s.carrier}"`);
    }
  }
  return out;
}

/**
 * Fields flagged "check" for ADH: a missing premium, and whatever the note
 * says was assumed / unclear ("contract assumed", "customer shown as ??",
 * "200 or 265", "235 next to 260").
 */
export function checkFieldsFor(o: Pick<OpenOrder, 'clientFixedPremium' | 'note'>): string[] {
  const out = new Set<string>();
  if (o.clientFixedPremium === null || o.clientFixedPremium === undefined) out.add('clientPremium');
  // Clause by clause: "customer shown as ?? …; contract 454003652 is the Hoei contract; … step 3 is a guess, flag check".
  for (const clause of (o.note ?? '').toLowerCase().split(/[;\n]+/)) {
    if (!/check|assum|\?\?|unclear|not filled|guess/.test(clause)) continue;
    if (/contract/.test(clause)) out.add('contractId');
    if (/customer/.test(clause)) out.add('customerId');
    if (/\bstep\b|status/.test(clause)) out.add('currentStep');
    if (/premium|\d{3}\s*'?\s*(or|next to)\s*'?\d{3}/.test(clause)) out.add('clientPremium');
  }
  return [...out];
}

/** The contract line an order defaults from (as OrdersService does): same grade, else the only line. */
export function lineFor<L extends { grade: string | null }>(lines: L[], grade: string): { line: L | null; sameGrade: boolean } {
  const same = lines.find((l) => (l.grade ?? '').trim() === grade.trim()) ?? null;
  return { line: same ?? (lines.length === 1 ? lines[0] : null), sameGrade: !!same };
}

/**
 * The task list's client premium is the whole fixed part (6005 SUS "200" = 190 + the 10 upcharge);
 * the order keeps the upcharge apart, so the stored client premium is fixed − upcharge.
 */
export const clientPremiumToStore = (fixed: number, upcharge: unknown) => Math.round((fixed - (Number(upcharge) || 0)) * 100) / 100;

/** "WAN HAI 366 / E049" → vessel + voyage; a transshipment ("SITC CAGAYAN 2613N / SITC CHANGDE 2617N") stays whole. */
export function splitVesselVoyage(v: string | null | undefined): { vessel: string | null; voyageNo: string | null } {
  const t = (v ?? '').trim();
  if (!t) return { vessel: null, voyageNo: null };
  const m = /^(.*?)\s*\/\s*([^/]+)$/.exec(t);
  if (m && /^(V\.?\s*)?[A-Z]?\d{2,4}[A-Z]?$/i.test(m[2].trim())) return { vessel: m[1].trim(), voyageNo: m[2].trim() };
  return { vessel: t, voyageNo: null };
}

/** "3a" → 3, "13" → 13, null for none. */
export const stepNumber = (displayNo: string | null | undefined) => {
  const m = /^(\d+)/.exec(displayNo ?? '');
  return m ? Number(m[1]) : null;
};

export interface PlanStep {
  id: string;
  displayNo: string | null;
  sortOrder: number;
  status: string;
  isOngoing: boolean;
  notApplicable: boolean;
}

/**
 * Steps of one owner (supplier order / order / shipment) for the task list's
 * current step: every applicable step numbered below it → done; the first
 * applicable one numbered at it → in progress. N/A (profile rules) and
 * ongoing steps are left alone; steps already done stay done.
 */
export function stepPlan(steps: PlanStep[], currentStep: number): { done: PlanStep[]; start: PlanStep | null } {
  const live = [...steps].sort((a, b) => a.sortOrder - b.sortOrder).filter((s) => !s.notApplicable && !s.isOngoing && stepNumber(s.displayNo) !== null);
  const done = live.filter((s) => stepNumber(s.displayNo)! < currentStep && s.status !== 'DONE');
  const at = live.find((s) => stepNumber(s.displayNo) === currentStep && s.status !== 'DONE') ?? null;
  return { done, start: at && at.status === 'NOT_STARTED' ? at : null };
}
