/**
 * Round AY part 2 — due dates per step. Every step's due date comes from a rule on the shipment schedule (ETD / ETA)
 * or the order (entered / PI date), so it moves by itself when ETD / ETA change (Wan Hai tracking, a carrier email, an
 * edit). A due date set by hand on one order / shipment step (TradeStep.dueAt) wins and stays put. Due dates only
 * inform: the order page's Overall process, the Tasks list, the Dashboard and the Monthly view's "overdue" badge — no
 * reminder rows, no bell, no e-mail, no WhatsApp. Pure: no Prisma, no Nest.
 */
import { addBusinessDays } from './trade-invoice';
import { depositDueDate } from './trade-deposit';

/**
 * Round BG: SHIP_MONTH_DAY = day `day` of the order's ship month (SUS: Invoice #1 on the 9th); SHIPPING_DOCS_DONE =
 * after step 3b is done on every live shipment of the order (the latest done date; Kato's single invoice).
 */
export type DueAnchor = 'ORDER_CREATED' | 'DEPOSIT_TERM' | 'ETD' | 'ETA' | 'FIRST_ETD' | 'LAST_ETA' | 'SHIP_MONTH_DAY' | 'SHIPPING_DOCS_DONE';
export interface DueRule {
  anchor: DueAnchor;
  /** Days after (+) / before (−) the anchor. */
  days: number;
  business?: boolean;
  /** Why (shown with the date). */
  why: string;
  /** Round BG: SHIP_MONTH_DAY's day of the month (1–31; past the month's end → its last day). */
  day?: number;
  /** Round BG: how the days read in the rule ("1–2"); the due date uses `days`. */
  daysText?: string;
  /** Round BG: the Japanese wording (customer rules). */
  whyJa?: string;
  /** Round BG: where the rule comes from. */
  origin?: 'default' | 'customer';
}
/** Round BG: a customer's own rule for one step (Clients › customer › Process), stored on the profile's dueRules. */
export type CustomerDueRule = Pick<DueRule, 'anchor' | 'days' | 'business' | 'day' | 'daysText'>;

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

export function ruleFor(code: string, billingMode?: string | null, taxFundingDaysBefore?: number | null, custom?: Record<string, CustomerDueRule> | null): DueRule | null {
  // Round BG: the customer's own rule for this step wins over the global default.
  const own = custom?.[code];
  if (own) return { ...own, why: describeRule(own, 'en'), whyJa: describeRule(own, 'ja'), origin: 'customer' };
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
  /** Round BP: the PI's "Instrument to be received by" date — wins over PI date + term. */
  depositDueDate?: Date | string | null;
  /** This shipment's schedule (shipment steps). */
  etd?: Date | string | null;
  eta?: Date | string | null;
  /** The order's live shipments: earliest ETD / latest ETA (order steps). */
  firstEtd?: Date | string | null;
  lastEta?: Date | string | null;
  billingMode?: string | null;
  taxFundingDaysBefore?: number | null;
  /** Round BG: the order's ship month (YYYY-MM). */
  shipMonth?: string | null;
  /** Round BG: the latest step 3b done date when 3b is done on every live shipment (else null). */
  shippingDocsDone?: Date | string | null;
  /** Round BG: the customer's own rules (profile.dueRules). */
  customRules?: Record<string, CustomerDueRule> | null;
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
/** Day `day` of month YYYY-MM (past the month's end → its last day). */
export function monthDay(ym: string | null | undefined, day: number): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym ?? '');
  if (!m || !(day >= 1)) return null;
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(Math.min(Math.floor(day), last)).padStart(2, '0')}`;
}
const anchorDay = (a: DueAnchor, c: DueContext, r?: DueRule): string | null =>
  a === 'ORDER_CREATED'
    ? dayOf(c.orderCreatedAt)
    : a === 'ETD'
      ? dayOf(c.etd)
      : a === 'ETA'
        ? dayOf(c.eta)
        : a === 'FIRST_ETD'
          ? dayOf(c.firstEtd)
          : a === 'LAST_ETA'
            ? dayOf(c.lastEta)
            : a === 'SHIP_MONTH_DAY'
              ? monthDay(c.shipMonth, r?.day ?? 1)
              : a === 'SHIPPING_DOCS_DONE'
                ? dayOf(c.shippingDocsDone)
                : null;

export interface DueInfo {
  /** YYYY-MM-DD, or null (no rule / the schedule date isn't known yet). */
  due: string | null;
  source: 'manual' | 'rule' | null;
  /** The rule in words ("10 days before ETA"); for a manual date the rule it replaced. */
  why: string | null;
  /** Round BG: the rule used (default or the customer's). */
  rule?: DueRule | null;
}

/** A step's due date: the manual one, else the rule on the schedule. */
export function dueOf(code: string, c: DueContext, manual?: Date | string | null): DueInfo {
  const rule = ruleFor(code, c.billingMode, c.taxFundingDaysBefore, c.customRules);
  const m = dayOf(manual);
  if (m) return { due: m, source: 'manual', why: rule?.why ?? null, rule };
  if (!rule) return { due: null, source: null, why: null };
  if (rule.anchor === 'DEPOSIT_TERM') {
    // Round BP: the date the PI prints ("Instrument to be received by") when the order has it; else PI date + the term.
    const printed = dayOf(c.depositDueDate ?? null);
    if (printed) return { due: printed, source: 'rule', why: 'the PI\'s "Instrument to be received by" date', rule };
    const d = depositDueDate(c.piDate ?? null, c.depositDueDays ?? 3, c.depositDueUnit ?? 'BUSINESS');
    return { due: d, source: d ? 'rule' : null, why: rule.why, rule };
  }
  const a = anchorDay(rule.anchor, c, rule);
  if (!a) return { due: null, source: null, why: rule.why, rule };
  const due = rule.business && rule.days > 0 ? addBusinessDays(a, rule.days) : plusDays(a, rule.days);
  return { due, source: 'rule', why: rule.why, rule };
}

export type StepState = 'done' | 'current' | 'upcoming' | 'overdue' | 'na';

/**
 * done / N/A first; past its due date and not done → overdue; the record's first open step → current. Round AZ: a due
 * date before the day due dates were switched on (`since`) is never flagged — it shows the date without the badge,
 * so switching on doesn't flood the lists with the backlog.
 */
export function stepState(s: { status: string; notApplicable?: boolean | null; isOngoing?: boolean }, due: string | null, today: string, isCurrent: boolean, since?: string | null): StepState {
  if (s.notApplicable) return 'na';
  if (s.status === 'DONE') return 'done';
  if (due && due < today && !s.isOngoing && flaggable(due, since)) return 'overdue';
  return isCurrent ? 'current' : 'upcoming';
}

/** Round AZ: whether a due date counts (due / overdue / a task): on or after the switch-on day. */
export const flaggable = (due: string | null, since?: string | null) => !!due && (!since || due >= since);

/** Days late (positive) for an overdue date. */
export const daysLate = (due: string, today: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);

/** The text of the default rules, for the report / Guide. */
export const dueRulesTable = () =>
  Object.entries(DEFAULT_DUE_RULES).map(([code, r]) => ({ code, rule: r.why })).concat([{ code: 'INVOICE_2 (single billing)', rule: SINGLE_INVOICE_RULE.why }]);

// ── Round BG: customer rules (Clients › customer › Process) ─────────────────
export const CUSTOM_ANCHORS: DueAnchor[] = ['ORDER_CREATED', 'ETD', 'ETA', 'FIRST_ETD', 'LAST_ETA', 'SHIP_MONTH_DAY', 'SHIPPING_DOCS_DONE'];
const ANCHOR_WORDS: Record<DueAnchor, { en: string; ja: string }> = {
  ORDER_CREATED: { en: 'the order is entered', ja: '注文登録' },
  DEPOSIT_TERM: { en: "the PI date + the order's deposit term", ja: 'PI日付＋前払期限' },
  ETD: { en: 'ETD', ja: 'ETD' },
  ETA: { en: 'ETA', ja: 'ETA' },
  FIRST_ETD: { en: 'the first shipment sails (ETD)', ja: '最初の出荷のETD' },
  LAST_ETA: { en: "the last shipment's ETA", ja: '最後の出荷のETA' },
  SHIP_MONTH_DAY: { en: 'the ship month', ja: '出荷月' },
  SHIPPING_DOCS_DONE: { en: 'the shipping documents are received (step 3b; the latest shipment)', ja: '船積書類の受領（ステップ3b・最後の出荷）' },
};
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/** A rule in words, EN / JA ("the 9th of the ship month", "1–2 days after the shipping documents are received …"). */
export function describeRule(r: Pick<DueRule, 'anchor' | 'days' | 'business' | 'day' | 'daysText'>, lang: 'en' | 'ja'): string {
  const w = ANCHOR_WORDS[r.anchor]?.[lang] ?? r.anchor;
  const n = Math.abs(r.days);
  const nText = r.daysText?.trim() || String(n);
  if (r.anchor === 'SHIP_MONTH_DAY') {
    const base = lang === 'en' ? `the ${ordinal(r.day ?? 1)} of the ship month` : `出荷月の${r.day ?? 1}日`;
    if (!r.days) return base;
    return lang === 'en' ? `${nText} ${r.business ? 'business ' : ''}day${n === 1 ? '' : 's'} ${r.days > 0 ? 'after' : 'before'} ${base}` : `${base}の${nText}${r.business ? '営業' : ''}日${r.days > 0 ? '後' : '前'}`;
  }
  if (!r.days) return lang === 'en' ? `on the day ${w}` : `${w}の当日`;
  if (lang === 'ja') return `${w}の${nText}${r.business ? '営業' : ''}日${r.days > 0 ? '後' : '前'}`;
  const unit = `${r.business ? 'business ' : ''}day${n === 1 && !r.daysText ? '' : 's'}`;
  const tail = r.daysText && r.daysText.trim() !== String(n) ? ` (due date: ${n} ${r.business ? 'business ' : ''}day${n === 1 ? '' : 's'})` : '';
  return `${nText} ${unit} ${r.days > 0 ? 'after' : 'before'} ${w}${tail}`;
}

/** Validate a customer's dueRules ({ code: rule | null }); null / absent = the default. Returns the clean map. */
export function cleanDueRules(v: unknown, isStep: (code: string) => boolean, fail: (msg: string) => never): Record<string, CustomerDueRule> {
  if (v === null || v === undefined) return {};
  if (typeof v !== 'object' || Array.isArray(v)) fail('dueRules must be an object of step code → rule');
  const out: Record<string, CustomerDueRule> = {};
  for (const [code, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!isStep(code)) fail(`Unknown step "${code}"`);
    if (code === 'DELIVERY_CHANGES') fail('Step 14 runs alongside: it has no due date');
    if (raw === null || raw === undefined) continue;
    const r = raw as Record<string, unknown>;
    if (!CUSTOM_ANCHORS.includes(r.anchor as DueAnchor)) fail(`Unknown due-date anchor "${String(r.anchor)}"`);
    const days = Number(r.days ?? 0);
    if (!Number.isInteger(days) || Math.abs(days) > 365) fail('days must be a whole number (−365…365)');
    const rule: CustomerDueRule = { anchor: r.anchor as DueAnchor, days };
    if (r.business === true) rule.business = true;
    if (rule.anchor === 'SHIP_MONTH_DAY') {
      const day = Number(r.day);
      if (!Number.isInteger(day) || day < 1 || day > 31) fail('day must be 1–31');
      rule.day = day;
    }
    if (r.daysText !== undefined && r.daysText !== null && r.daysText !== '') {
      if (typeof r.daysText !== 'string' || r.daysText.trim().length > 12) fail('daysText must be short text ("1–2")');
      rule.daysText = (r.daysText as string).trim();
    }
    out[code] = rule;
  }
  return out;
}

/** Round BG: one open step whose due date / badge a rule change moves (the Process tab's preview and the dry run). */
export interface DueChange {
  stepId: string;
  orderId: string;
  ref: string;
  no: string;
  code: string;
  title: string;
  before: { due: string | null; badge: string | null; why: string | null };
  after: { due: string | null; badge: string | null; why: string | null };
}
type DueLike = { stepId: string; orderId: string; ref: string; no: string; code: string; title: string; due: string | null; state: string; daysLate: number | null; dueWhy: string | null };
const badgeOf = (i: DueLike) => (i.state === 'overdue' ? `${i.daysLate}d overdue` : null);
/** Open steps whose due date or badge differs between two runs of the same orders (steps in the same order). */
export function dueChanges(before: DueLike[], after: DueLike[]): DueChange[] {
  const was = new Map(before.map((i) => [i.stepId, i]));
  const out: DueChange[] = [];
  for (const a of after) {
    const b = was.get(a.stepId);
    if (!b || a.state === 'done' || a.state === 'na') continue;
    if (b.due === a.due && badgeOf(b) === badgeOf(a)) continue; // wording only
    out.push({ stepId: a.stepId, orderId: a.orderId, ref: a.ref, no: a.no, code: a.code, title: a.title, before: { due: b.due, badge: badgeOf(b), why: b.dueWhy }, after: { due: a.due, badge: badgeOf(a), why: a.dueWhy } });
  }
  return out;
}
