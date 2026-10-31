/**
 * Round AY part 2 — due dates per step. Every step's due date comes from a rule on the shipment schedule (ETD / ETA)
 * or the order (entered / PI date), so it moves by itself when ETD / ETA change (Wan Hai tracking, a carrier email, an
 * edit). A due date set by hand on one order / shipment step (TradeStep.dueAt) wins and stays put. Due dates only
 * inform: the order page's Overall process, the Tasks list, the Dashboard and the Monthly view's "overdue" badge — no
 * reminder rows, no bell, no e-mail, no WhatsApp. Pure: no Prisma, no Nest.
 */
import { addBusinessDays } from './trade-invoice';
import { depositDueDate } from './trade-deposit';

export type DueAnchor = 'ORDER_CREATED' | 'DEPOSIT_TERM' | 'ETD' | 'ETA' | 'FIRST_ETD' | 'LAST_ETA';
export interface DueRule {
  anchor: DueAnchor;
  /** Days after (+) / before (−) the anchor. */
  days: number;
  business?: boolean;
  /** Why (shown with the date). */
  why: string;
}

/**
 * The default rules (proposal — ADH to confirm). Shipment steps hang off that shipment's ETD / ETA; order steps off
 * the order (0, 1), its first shipment's ETD (2) or its last shipment's ETA (11, 13). Step 8 follows the tax-funding
 * reminder (Alerts: 14 days before ETA). 14 is ongoing: no due date.
 */
export const DEFAULT_DUE_RULES: Record<string, DueRule> = {
  CHECK_CONTRACT: { anchor: 'ORDER_CREATED', days: 2, business: true, why: '2 business days after the order is entered' },
  PI_PAYMENT: { anchor: 'DEPOSIT_TERM', days: 0, why: "PI date + the order's deposit term" },
  INVOICE_1: { anchor: 'FIRST_ETD', days: 3, business: true, why: '3 business days after the first shipment sails (ETD)' },
  BL_DRAFT_APPROVAL: { anchor: 'ETD', days: -2, why: '2 days before ETD' },
  SHIPPING_DOCS: { anchor: 'ETD', days: 7, why: '7 days after ETD' },
  CUSTOMER_DOCS: { anchor: 'ETA', days: -14, why: '14 days before ETA' },
  SEND_DOCS_SCHEDULE: { anchor: 'ETA', days: -10, why: '10 days before ETA' },
  CI_PAYMENT: { anchor: 'ETD', days: 3, business: true, why: '3 bank working days after the B/L (≈ ETD)' },
  CUSTOMS_TAX_ESTIMATE: { anchor: 'ETA', days: -17, why: '17 days before ETA (3 days before the tax funds)' },
  TAX_FUNDS: { anchor: 'ETA', days: -14, why: '14 days before ETA (the tax-funding reminder)' },
  AN_INSTRUCTIONS: { anchor: 'ETA', days: -1, why: 'the day before ETA (the A/N comes ~2 days before)' },
  IMPORT_PERMIT: { anchor: 'ETA', days: 3, why: '3 days after ETA (customs clearance)' },
  INVOICE_2: { anchor: 'LAST_ETA', days: 14, why: "14 days after the last shipment's ETA" },
  LOGISTICS_PAYMENT: { anchor: 'ETA', days: 30, why: '30 days after ETA (Mitsui Soko / trucking bills)' },
  XERO_HANDOFF: { anchor: 'LAST_ETA', days: 45, why: "45 days after the last shipment's ETA" },
};
/** The single invoice (Kato / Hoei) goes out after the B/L, not after delivery. */
export const SINGLE_INVOICE_RULE: DueRule = { anchor: 'FIRST_ETD', days: 5, business: true, why: '5 business days after the first shipment sails (single invoice after the B/L)' };

export function ruleFor(code: string, billingMode?: string | null, taxFundingDaysBefore?: number | null): DueRule | null {
  if (code === 'INVOICE_2' && billingMode === 'SINGLE') return SINGLE_INVOICE_RULE;
  const r = DEFAULT_DUE_RULES[code];
  if (!r) return null;
  if (code === 'TAX_FUNDS' && typeof taxFundingDaysBefore === 'number') return { ...r, days: -taxFundingDaysBefore, why: `${taxFundingDaysBefore} days before ETA (the tax-funding reminder)` };
  return r;
}

export interface DueContext {
  orderCreatedAt?: Date | string | null;
  piDate?: Date | string | null;
  depositDueDays?: number | null;
  depositDueUnit?: string | null;
  /** This shipment's schedule (shipment steps). */
  etd?: Date | string | null;
  eta?: Date | string | null;
  /** The order's live shipments: earliest ETD / latest ETA (order steps). */
  firstEtd?: Date | string | null;
  lastEta?: Date | string | null;
  billingMode?: string | null;
  taxFundingDaysBefore?: number | null;
}

export const dayOf = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const s = typeof d === 'string' ? d : d.toISOString();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const plusDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const anchorDay = (a: DueAnchor, c: DueContext): string | null =>
  a === 'ORDER_CREATED' ? dayOf(c.orderCreatedAt) : a === 'ETD' ? dayOf(c.etd) : a === 'ETA' ? dayOf(c.eta) : a === 'FIRST_ETD' ? dayOf(c.firstEtd) : a === 'LAST_ETA' ? dayOf(c.lastEta) : null;

export interface DueInfo {
  /** YYYY-MM-DD, or null (no rule / the schedule date isn't known yet). */
  due: string | null;
  source: 'manual' | 'rule' | null;
  /** The rule in words ("10 days before ETA"); for a manual date the rule it replaced. */
  why: string | null;
}

/** A step's due date: the manual one, else the rule on the schedule. */
export function dueOf(code: string, c: DueContext, manual?: Date | string | null): DueInfo {
  const rule = ruleFor(code, c.billingMode, c.taxFundingDaysBefore);
  const m = dayOf(manual);
  if (m) return { due: m, source: 'manual', why: rule?.why ?? null };
  if (!rule) return { due: null, source: null, why: null };
  if (rule.anchor === 'DEPOSIT_TERM') {
    const d = depositDueDate(c.piDate ?? null, c.depositDueDays ?? 3, c.depositDueUnit ?? 'BUSINESS');
    return { due: d, source: d ? 'rule' : null, why: rule.why };
  }
  const a = anchorDay(rule.anchor, c);
  if (!a) return { due: null, source: null, why: rule.why };
  const due = rule.business && rule.days > 0 ? addBusinessDays(a, rule.days) : plusDays(a, rule.days);
  return { due, source: 'rule', why: rule.why };
}

export type StepState = 'done' | 'current' | 'upcoming' | 'overdue' | 'na';

/** done / N/A first; past its due date and not done → overdue; the record's first open step → current. */
export function stepState(s: { status: string; notApplicable?: boolean | null; isOngoing?: boolean }, due: string | null, today: string, isCurrent: boolean): StepState {
  if (s.notApplicable) return 'na';
  if (s.status === 'DONE') return 'done';
  if (due && due < today && !s.isOngoing) return 'overdue';
  return isCurrent ? 'current' : 'upcoming';
}

/** Days late (positive) for an overdue date. */
export const daysLate = (due: string, today: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);

/** The text of the default rules, for the report / Guide. */
export const dueRulesTable = () =>
  Object.entries(DEFAULT_DUE_RULES).map(([code, r]) => ({ code, rule: r.why })).concat([{ code: 'INVOICE_2 (single billing)', rule: SINGLE_INVOICE_RULE.why }]);
