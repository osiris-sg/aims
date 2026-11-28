// Commission report (guru 2026-11-28, WCT group; flag enableCommissionReport).
//
// What the office did by hand each month (Google sheet "payment receipt" → Excel per salesperson →
// payment slip): take every CUSTOMER PAYMENT received in the month, work out its amount before GST,
// split it by job type (CD / AA / MV / VO / TS) the way the invoice's lines split, find the
// salesperson, and pay a percentage that depends on the type and on the person. A job whose supplier
// cost leaves less than 30% margin earns nothing. This file is that calculation, pure and testable;
// the service feeds it the documents.
//
// What it does NOT decide: which payments the office chooses to leave out (their "first payment
// only" rule for monthly jobs) and how a shared job is split between two salespeople. Those are
// per-row choices: every row can be excluded or given its own rate, and the choice is saved.

export const JOB_TYPES = ['CD', 'AA', 'MV', 'VO', 'TS'] as const;
export const UNTYPED = 'UNTYPED';
/** The office's standard rates (% of the payment before GST). */
export const STANDARD_RATES: Record<string, number> = { CD: 8, AA: 5, MV: 5, VO: 5, TS: 1 };

export interface CommissionPerson {
  name: string;
  /** The person's AIMS account, when they were picked from the organization's users. */
  userId?: string | null;
  /** Other spellings of this person on documents ("henry hoo", "S003"). */
  aliases?: string[];
  /** Their own rate per type; a type left out uses the standard rate. */
  rates?: Record<string, number>;
  /** Earns on EVERY job, not only their own (the manager's override). */
  allJobs?: boolean;
}
export interface CommissionSettings {
  rates: Record<string, number>;
  minMarginPct: number;
  /**
   * Job types paid only when the WHOLE JOB (the quotation) is fully paid, and then on every payment
   * of the job at once, earlier months included. The office's rule (confirmed by guru 2026-11-28,
   * "whole quotation"): CD is paid on each payment as it comes in; everything else waits.
   */
  holdTypes: string[];
  /** Invoices whose number starts with one of these earn no commission (e.g. another business's series). */
  skipNumbers: string[];
  /**
   * Big jobs paid on profit, not on sales (guru 2026-11-28: "Racking, if the job is more than 200k
   * then need to deduct costing"): in a company whose name contains `company`, a job worth more than
   * `above` earns commission on each payment LESS the job's supplier cost, in proportion.
   */
  deductCost: Array<{ company: string; above: number }>;
  people: CommissionPerson[];
}
export interface RowOverride { rate?: number | null; exclude?: boolean; type?: string | null }

export const HOLD_TYPES_DEFAULT = ['AA', 'MV', 'VO', 'TS'];
export const defaultSettings = (): CommissionSettings => ({ rates: { ...STANDARD_RATES }, minMarginPct: 30, holdTypes: [...HOLD_TYPES_DEFAULT], skipNumbers: [], deductCost: [], people: [] });

const R = (n: unknown) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);

/** Settings as stored, made safe: numbers are numbers, names are trimmed, duplicates dropped. */
export function cleanSettings(raw: any): CommissionSettings {
  const d = defaultSettings();
  const rates: Record<string, number> = { ...d.rates };
  for (const t of JOB_TYPES) rates[t] = Math.max(0, Math.min(100, num(raw?.rates?.[t], d.rates[t])));
  const seen = new Set<string>();
  const people: CommissionPerson[] = [];
  for (const p of Array.isArray(raw?.people) ? raw.people : []) {
    const name = String(p?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!name || seen.has(norm(name))) continue;
    seen.add(norm(name));
    const own: Record<string, number> = {};
    for (const t of JOB_TYPES) if (p?.rates?.[t] !== undefined && p.rates[t] !== null && p.rates[t] !== '') own[t] = Math.max(0, Math.min(100, num(p.rates[t], rates[t])));
    people.push({
      name,
      userId: typeof p?.userId === 'string' && p.userId.trim() ? p.userId.trim().slice(0, 80) : null,
      aliases: (Array.isArray(p?.aliases) ? p.aliases : []).map((a: unknown) => String(a ?? '').trim()).filter(Boolean).slice(0, 20),
      rates: own,
      allJobs: p?.allJobs === true,
    });
  }
  const holdTypes = Array.isArray(raw?.holdTypes) ? (JOB_TYPES as readonly string[]).filter((t) => raw.holdTypes.includes(t)) : d.holdTypes;
  const skipNumbers = (Array.isArray(raw?.skipNumbers) ? raw.skipNumbers : String(raw?.skipNumbers ?? '').split(','))
    .map((x: unknown) => String(x ?? '').trim().toUpperCase()).filter(Boolean).slice(0, 20);
  const deductCost = (Array.isArray(raw?.deductCost) ? raw.deductCost : [])
    .map((r: any) => ({ company: String(r?.company ?? '').replace(/\s+/g, ' ').trim().slice(0, 80), above: Math.max(0, num(r?.above, 0)) }))
    .filter((r: { company: string }) => r.company).slice(0, 10);
  return { rates, minMarginPct: Math.max(0, Math.min(100, num(raw?.minMarginPct, d.minMarginPct))), holdTypes, skipNumbers, deductCost, people };
}

/**
 * The people a document's Sales Person field names. "Henry & Rave" is two people (a shared job).
 * A name matches a configured person by its exact text, one of their aliases, or their first name
 * ("Henry Hoo" is Henry). A name nobody is set up for stays as typed, so it shows up to be fixed.
 */
export function salespeopleOf(raw: unknown, people: CommissionPerson[]): string[] {
  const out: string[] = [];
  for (const part of String(raw ?? '').split(/\s*(?:&|\/|,|\band\b)\s*/i)) {
    const n = norm(part);
    if (!n) continue;
    const hit =
      people.find((p) => norm(p.name) === n || (p.aliases || []).some((a) => norm(a) === n)) ||
      people.find((p) => norm(p.name).split(' ')[0] === n.split(' ')[0] && n.split(' ')[0].length >= 3);
    const name = hit ? hit.name : part.replace(/\s+/g, ' ').trim();
    if (!out.some((x) => norm(x) === norm(name))) out.push(name);
  }
  return out;
}

/**
 * The configured person an old-ERP login belongs to, or '' (guru 2026-11-28). The old ERP left the
 * Sales Person field empty on the quotations a salesperson keyed in themselves and recorded only
 * their login ("ravewct", "joyna"). Only an exact name or alias counts: an office login that is
 * nobody's alias ("kherrywct") names no salesperson.
 */
export function personOfLogin(login: unknown, people: CommissionPerson[]): string {
  const n = norm(login);
  if (!n) return '';
  return people.find((p) => norm(p.name) === n || (p.aliases || []).some((a) => norm(a) === n))?.name || '';
}

export interface InvoiceLine { amount: number; accountCode?: string | null; description?: string | null }

const PREFIX = /^\s*(CD|AA|MV|VO|TS)\s*[-–:]/i;

/**
 * An invoice's value per job type. A line's type is its sales account's type; with no account, the
 * section it sits in: the office heads a section with a line like "AA- Dismantle…", and lines
 * before any heading belong to the first type the subject names ("CD+AA - …"). Value that has no
 * type by either rule is UNTYPED, never guessed into one.
 * `guessed` lists the types that came from the wording rather than an account.
 */
export function splitByType(
  lines: InvoiceLine[],
  subject: unknown,
  typeOfAccount: (code: string) => string | null,
): { shares: Array<{ type: string; amount: number }>; guessed: Set<string> } {
  const fromSubject = String(subject ?? '').match(/^\s*(CD|AA|MV|VO|TS)\b/i)?.[1]?.toUpperCase() || null;
  let section: string | null = fromSubject;
  const by = new Map<string, number>();
  const guessed = new Set<string>();
  for (const l of lines || []) {
    const head = String(l?.description ?? '').match(PREFIX)?.[1]?.toUpperCase();
    if (head) section = head;
    const amount = Number(l?.amount) || 0;
    if (!amount) continue;
    const code = String(l?.accountCode ?? '').trim();
    let type = code ? typeOfAccount(code) : null;
    // One account holds both AA and VO: the wording says which.
    if (type === 'AA' && section === 'VO') type = 'VO';
    if (!type) {
      type = section || UNTYPED;
      if (type !== UNTYPED) guessed.add(type);
    }
    by.set(type, R((by.get(type) || 0) + amount));
  }
  return { shares: Array.from(by.entries()).map(([type, amount]) => ({ type, amount })), guessed };
}

export interface PaymentIn {
  key: string; // receipt (or payment) id
  number: string; // receipt number
  date: string; // YYYY-MM-DD
  chequeNo?: string | null;
  invoiceId: string;
  amount: number; // as received, GST included
}
export interface InvoiceIn {
  id: string;
  number: string;
  customer: string;
  salesPerson: string; // as written on the invoice, else on its quotation
  subject?: string | null;
  net: number; // before GST
  gross: number; // GST included
  lines: InvoiceLine[];
  quotation?: { id: string; number: string; net: number } | null;
  /** The company (organization) the invoice belongs to, for a group report. */
  company?: string;
}

export interface CommissionRow {
  key: string; // payment | invoice | type | person: what an override is saved against
  person: string;
  date: string;
  receipt: string;
  chequeNo: string;
  customer: string;
  quotation: string;
  invoice: string;
  invoiceId: string;
  /** The job (its quotation, else the invoice itself): the key of its proof. */
  jobId: string;
  company: string;
  type: string;
  typeGuessed: boolean;
  amount: number; // this type's share of the payment, before GST
  /** What the rate is applied to: the amount, or the amount less the job's cost where that rule applies. */
  basis: number;
  rate: number;
  commission: number;
  excluded: boolean;
  /** Waiting for the job to be fully paid: shown, earns nothing yet, not in the totals. */
  held: boolean;
  note: string;
  /** The office's saved choice for this row, as stored (so one change does not wipe another). */
  override: { rate: number | null; exclude: boolean; type: string | null };
}

export function computeCommission(input: {
  /** Every payment of the jobs concerned up to the end of the period (earlier months included). */
  payments: PaymentIn[];
  /** The period being paid: a payment outside it shows only when its job was fully paid inside it. */
  from?: string;
  to?: string;
  invoices: Map<string, InvoiceIn>;
  /** Supplier cost booked against a quotation (before GST), by quotation id. */
  costs: Map<string, number>;
  settings: CommissionSettings;
  overrides?: Record<string, RowOverride>;
  typeOfAccount: (code: string) => string | null;
}) {
  const { settings } = input;
  const overrides = input.overrides || {};
  const from = input.from || '0000-00-00';
  const to = input.to || '9999-99-99';
  const inPeriod = (d: string) => d >= from && d <= to;
  const hold = new Set(settings.holdTypes || []);
  const rateFor = (person: string, type: string) => {
    const p = settings.people.find((x) => norm(x.name) === norm(person));
    const own = p?.rates?.[type];
    return own !== undefined && own !== null ? Number(own) : Number(settings.rates[type] ?? 0);
  };
  const everyJob = settings.people.filter((p) => p.allJobs);
  const rows: CommissionRow[] = [];
  const dmy = (d: string) => d.split('-').reverse().join('/');
  // The payment before GST, in the invoice's own proportion.
  const netOf = (pay: PaymentIn, inv: InvoiceIn) => (inv.gross > 0 && inv.net > 0 ? R((pay.amount * inv.net) / inv.gross) : R(pay.amount));

  const usable = input.payments
    .filter((p) => p.amount > 0 && input.invoices.has(p.invoiceId))
    .filter((p) => !(settings.skipNumbers || []).some((x) => String(input.invoices.get(p.invoiceId)!.number).toUpperCase().startsWith(x)))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── when each job became fully paid ──
  // A job is the quotation (every invoice raised against it); an invoice with no quotation is its
  // own job. Fully paid = what has been received, before GST, reaches the quotation's value.
  const jobOf = (inv: InvoiceIn) => (inv.quotation ? `q:${inv.quotation.id}` : `i:${inv.id}`);
  const jobs = new Map<string, { target: number; received: number; paidOn: string | null }>();
  for (const pay of usable) {
    const inv = input.invoices.get(pay.invoiceId)!;
    const id = jobOf(inv);
    const job = jobs.get(id) || { target: inv.quotation && inv.quotation.net > 0 ? inv.quotation.net : inv.net, received: 0, paidOn: null };
    job.received = R(job.received + netOf(pay, inv));
    // A dollar or half a percent short is rounding, not money still owed.
    if (!job.paidOn && job.target > 0 && job.received >= job.target - Math.max(1, job.target * 0.005)) job.paidOn = pay.date;
    jobs.set(id, job);
  }

  for (const pay of usable) {
    const inv = input.invoices.get(pay.invoiceId)!;
    const net = netOf(pay, inv);
    const job = jobs.get(jobOf(inv))!;
    const split = splitByType(inv.lines, inv.subject, input.typeOfAccount);
    const lineTotal = split.shares.reduce((s, x) => s + x.amount, 0);
    const shares = lineTotal > 0 ? split.shares : [{ type: UNTYPED, amount: 1 }];
    const total = lineTotal > 0 ? lineTotal : 1;

    // The margin test, only where a supplier cost is on record for the job.
    const cost = inv.quotation ? input.costs.get(inv.quotation.id) || 0 : 0;
    const revenue = inv.quotation?.net || inv.net;
    const margin = cost > 0 && revenue > 0 ? R(((revenue - cost) / revenue) * 100) : null;
    const lowMargin = margin !== null && margin < settings.minMarginPct;
    // A big job paid on profit: each payment carries its share of the job's cost.
    const profitRule = (settings.deductCost || []).find((r) => norm(inv.company).includes(norm(r.company)) && job.target > r.above);
    const keep = profitRule && cost > 0 && job.target > 0 ? Math.max(0, 1 - cost / job.target) : 1;
    const costNote = !profitRule ? '' : cost > 0
      ? `Job ${R(job.target).toLocaleString('en-SG')} is over ${R(profitRule.above).toLocaleString('en-SG')}: cost ${R(cost).toLocaleString('en-SG')} deducted`
      : `Job is over ${R(profitRule.above).toLocaleString('en-SG')} but has no supplier cost on record: nothing deducted`;

    const owners = salespeopleOf(inv.salesPerson, settings.people);
    const earners: Array<{ name: string; why: string }> = owners.length
      ? owners.map((name) => ({ name, why: owners.length > 1 ? `Shared job: ${owners.filter((o) => o !== name).join(', ')}` : '' }))
      : [{ name: '(No salesperson)', why: 'No salesperson on the invoice or its quotation' }];
    for (const p of everyJob) if (!owners.some((o) => norm(o) === norm(p.name))) earners.push({ name: p.name, why: owners.length ? `On ${owners.join(' & ')}'s job` : 'On every job' });

    // Each type's share; the last one takes the rounding so the parts add up to the payment.
    let left = net;
    shares.forEach((sh, i) => {
      const part = i === shares.length - 1 ? R(left) : R((net * sh.amount) / total);
      left = R(left - part);
      // The job type is a fact about the payment, not about who earns on it: one choice, kept
      // under "*", serves every person's row of this share.
      const sharedPick = overrides[`${pay.key}|${inv.id}|${sh.type}|*`]?.type;
      const typeFor = (o: RowOverride) => {
        const picked = sharedPick || o.type;
        return { picked, type: picked && (JOB_TYPES as readonly string[]).includes(String(picked)) ? String(picked) : sh.type };
      };
      // Does this share show in this period, and is it payable yet?
      const waits = hold.has(typeFor({}).type);
      const releasedNow = !!job.paidOn && inPeriod(job.paidOn);
      let held = false;
      let when = '';
      if (!waits) {
        if (!inPeriod(pay.date)) return; // paid on each payment: only this period's payments
      } else if (releasedNow) {
        // The job was fully paid in this period: every payment of it is paid now, earlier ones too.
        if (!inPeriod(pay.date)) when = `Received ${dmy(pay.date)}; job fully paid ${dmy(job.paidOn!)}`;
      } else {
        if (!inPeriod(pay.date)) return; // an old payment of a job that was not completed in this period
        if (!job.paidOn) { held = true; when = `Waiting: job not fully paid (${R(job.received).toLocaleString('en-SG')} of ${R(job.target).toLocaleString('en-SG')} received)`; }
        // paid in full in an EARLIER period and more came in now: nothing to wait for, pay it.
      }
      for (const e of earners) {
        const key = `${pay.key}|${inv.id}|${sh.type}|${norm(e.name)}`;
        const o = overrides[key] || {};
        const { picked, type } = typeFor(o);
        const unassigned = e.name === '(No salesperson)';
        const rate = o.rate !== undefined && o.rate !== null ? Number(o.rate) : unassigned || type === UNTYPED ? 0 : rateFor(e.name, type);
        const excluded = o.exclude === true;
        // A typed-in rate is the office's own decision and stands, margin or not.
        const blocked = lowMargin && !profitRule && (o.rate === undefined || o.rate === null);
        const notes = [when, e.why, costNote, margin !== null && !profitRule ? `Margin ${margin}%${lowMargin ? ` is under ${settings.minMarginPct}%` : ''}` : '', type === UNTYPED ? 'Job type not known: pick one' : ''].filter(Boolean);
        rows.push({
          key, person: e.name, date: pay.date, receipt: pay.number, chequeNo: pay.chequeNo || '', customer: inv.customer,
          quotation: inv.quotation?.number || '', invoice: inv.number, invoiceId: inv.id, jobId: jobOf(inv), company: inv.company || '', type, typeGuessed: !picked && split.guessed.has(sh.type),
          amount: part, basis: R(part * keep), rate: R(rate), commission: excluded || blocked || held ? 0 : R((part * keep * rate) / 100), excluded, held, note: notes.join(' · '),
          override: { rate: o.rate !== undefined && o.rate !== null ? Number(o.rate) : null, exclude: excluded, type: picked ? String(picked) : null },
        });
      }
    });
  }

  const order = (a: CommissionRow, b: CommissionRow) => a.company.localeCompare(b.company) || a.customer.localeCompare(b.customer) || a.invoice.localeCompare(b.invoice) || a.date.localeCompare(b.date) || a.type.localeCompare(b.type);
  const names = Array.from(new Set(rows.map((r) => r.person)));
  names.sort((a, b) => (a.startsWith('(') ? 1 : 0) - (b.startsWith('(') ? 1 : 0) || a.localeCompare(b));
  const people = names.map((name) => {
    const mine = rows.filter((r) => r.person === name).sort(order);
    const live = mine.filter((r) => !r.excluded && !r.held);
    const byCompany: Record<string, number> = {};
    for (const r of live) byCompany[r.company] = R((byCompany[r.company] || 0) + r.commission);
    return {
      name, totalSales: R(live.reduce((s, r) => s + r.amount, 0)), totalCommission: R(live.reduce((s, r) => s + r.commission, 0)),
      heldSales: R(mine.filter((r) => r.held && !r.excluded).reduce((s, r) => s + r.amount, 0)), byCompany, rows: mine,
    };
  });
  return {
    people,
    // Per job: what has been received (before GST) against its value, and the day it was fully paid.
    jobs: Object.fromEntries(Array.from(jobs.entries()).map(([id, j]) => [id, { received: j.received, target: j.target, paidOn: j.paidOn }])),
    totals: { payments: new Set(rows.map((r) => `${r.receipt}|${r.invoiceId}|${r.date}`)).size, commission: R(people.reduce((s, p) => s + p.totalCommission, 0)) },
    // Names on documents that nobody in the rates table answers to.
    unknownNames: names.filter((n) => !n.startsWith('(') && !settings.people.some((p) => norm(p.name) === norm(n))),
  };
}
