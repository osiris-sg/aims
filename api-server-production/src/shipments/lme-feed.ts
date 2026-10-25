/**
 * Round AK — LME aluminium from Westmetall (pure helpers, no I/O).
 *
 * Source: https://www.westmetall.com/en/markdaten.php?action=table&field=LME_Al_cash (one table per year:
 * date · LME Aluminium Cash-Settlement · 3-month · stock) and ?action=averages (the monthly averages).
 * Validated 2026-10-25: the mean of the daily cash-settlement values, rounded HALF-UP to 2 dp, reproduces
 * Westmetall's monthly average and ADH's price log (Jun 2026 3,458.64 · Jul 3,155.98 · Aug 3,249.625 → 3,249.63).
 *
 * The org's LME table (TradeSetting.docDefaults.lmeByMonth) stays the one every helper reads. The feed only
 * fills months that are empty, and keeps updating a month only while the table still holds the value the feed
 * wrote (docDefaults.lmeAuto[month].value). A month typed by hand is never touched — a difference is reported.
 */

export const LME_SOURCE = 'westmetall';
export const LME_METAL = 'AL';
export const westmetallDailyUrl = (year?: number) => `https://www.westmetall.com/en/markdaten.php?action=table&field=LME_Al_cash${year ? `&year=${year}` : ''}`;
export const WESTMETALL_AVERAGES_URL = 'https://www.westmetall.com/en/markdaten.php?action=averages&field=LME_Al_cash';

export interface LmeDay {
  date: string; // YYYY-MM-DD
  cash: number;
  threeMonth: number | null;
  stock: number | null;
}
export interface LmeMonth {
  month: string; // YYYY-MM
  avg: number;
  days: number;
  /** Every trading day of the month is in: a later trading day has been published. */
  final: boolean;
}
/** What the feed wrote into an org's table (docDefaults.lmeAuto). */
export interface LmeAutoMark {
  value: number;
  final: boolean;
  days: number;
  at: string;
}

const MONTHS: Record<string, string> = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
const num = (s: string): number | null => {
  const t = s.replace(/&nbsp;/g, '').replace(/,/g, '').trim();
  if (!t || t === '-') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};
const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

/** Half-up rounding to 2 dp (Westmetall / ADH: 3,249.625 → 3,249.63), safe against binary float error. */
export function roundHalfUp2(v: number): number {
  return Math.round((v + Number.EPSILON * Math.max(1, Math.abs(v))) * 100) / 100;
}

/** Thrown when the page no longer looks like the table we know — nothing is written then. */
export class LmeParseError extends Error {}

/**
 * The daily table: rows "23. October 2026 | 3,043.00 | 3,018.00 | 235,800". Checks the header names the
 * aluminium cash-settlement column first, and that every value is plausible; otherwise throws LmeParseError.
 */
export function parseWestmetallDaily(html: string): LmeDay[] {
  if (!/LME Aluminium Cash-Settlement/i.test(html)) throw new LmeParseError('the "LME Aluminium Cash-Settlement" column is missing');
  const header = /<th[^>]*>\s*date\s*<\/th>\s*<th[^>]*>([^<]*)<\/th>\s*<th[^>]*>([^<]*)<\/th>\s*<th[^>]*>([^<]*)<\/th>/i.exec(html);
  if (!header || !/Aluminium Cash-Settlement/i.test(header[1]) || !/3-month/i.test(header[2]) || !/stock/i.test(header[3])) throw new LmeParseError('the table header changed');
  const out: LmeDay[] = [];
  const seen = new Set<string>();
  const re = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const d = /^(\d{1,2})\.\s*([A-Za-z]+)\s+(\d{4})$/.exec(strip(m[1]));
    if (!d) continue;
    const mm = MONTHS[d[2].toLowerCase()];
    if (!mm) throw new LmeParseError(`unknown month "${d[2]}"`);
    const date = `${d[3]}-${mm}-${d[1].padStart(2, '0')}`;
    const cash = num(strip(m[2]));
    if (cash === null) continue; // a holiday row without a settlement
    if (cash < 500 || cash > 20000) throw new LmeParseError(`implausible cash price ${cash} on ${date}`);
    if (seen.has(date)) throw new LmeParseError(`date ${date} appears twice`);
    seen.add(date);
    out.push({ date, cash, threeMonth: num(strip(m[3])), stock: num(strip(m[4])) });
  }
  if (!out.length) throw new LmeParseError('no daily rows found');
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The averages page: "October 3,054.88 3,055.82 238,179" for the year shown (the first year link). */
export function parseWestmetallAverages(html: string, year: number): Array<{ month: string; cash: number }> {
  if (!/LME Aluminium Cash-Settlement/i.test(html)) throw new LmeParseError('averages: the cash-settlement column is missing');
  const out: Array<{ month: string; cash: number }> = [];
  const re = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const mm = MONTHS[strip(m[1]).toLowerCase()];
    const cash = num(strip(m[2]));
    if (mm && cash !== null) out.push({ month: `${year}-${mm}`, cash });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

/** Monthly cash-settlement averages from the daily rows; a month is final once a later trading day exists. */
export function monthlyAverages(days: LmeDay[]): LmeMonth[] {
  const by = new Map<string, number[]>();
  for (const d of days) {
    const k = d.date.slice(0, 7);
    by.set(k, [...(by.get(k) ?? []), d.cash]);
  }
  const latest = days.reduce((m, d) => (d.date > m ? d.date : m), '');
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, avg: roundHalfUp2(v.reduce((s, x) => s + x, 0) / v.length), days: v.length, final: latest.slice(0, 7) > month }));
}

export interface LmeSyncPlan {
  /** Months to write into the table (empty, or still the feed's own value that moved / became final). */
  writes: Array<{ month: string; from: number | null; to: number; final: boolean; days: number; reason: 'empty' | 'provisional-update' | 'finalized' }>;
  /** Months typed by hand that differ from Westmetall — shown, never changed. */
  conflicts: Array<{ month: string; table: number; westmetall: number; final: boolean }>;
  /** Months typed by hand that agree with Westmetall. */
  agree: string[];
}

const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * What the feed may do to one org's table. `fromMonth` limits auto-fill (older months are left alone).
 * A month counts as the feed's own only while the table still holds exactly the value the feed wrote.
 */
export function planLmeSync(table: Record<string, number>, auto: Record<string, LmeAutoMark>, months: LmeMonth[], fromMonth: string): LmeSyncPlan {
  const plan: LmeSyncPlan = { writes: [], conflicts: [], agree: [] };
  for (const m of months) {
    if (m.month < fromMonth) continue;
    const cur = table[m.month];
    const mark = auto[m.month];
    if (cur === undefined || cur === null || !Number.isFinite(cur)) {
      plan.writes.push({ month: m.month, from: null, to: m.avg, final: m.final, days: m.days, reason: 'empty' });
      continue;
    }
    const ours = !!mark && same(cur, mark.value);
    if (ours) {
      if (!same(cur, m.avg) || mark.final !== m.final || mark.days !== m.days) plan.writes.push({ month: m.month, from: cur, to: m.avg, final: m.final, days: m.days, reason: m.final && !mark.final ? 'finalized' : 'provisional-update' });
      continue;
    }
    if (same(cur, m.avg)) plan.agree.push(m.month);
    else plan.conflicts.push({ month: m.month, table: cur, westmetall: m.avg, final: m.final });
  }
  return plan;
}

/** Provisional months of an org's table (the feed's own, month not over yet) — the price check treats them as provisional. */
export function provisionalMonths(table: Record<string, number>, auto: Record<string, LmeAutoMark> | undefined): string[] {
  return Object.entries(auto ?? {})
    .filter(([m, a]) => a && !a.final && typeof table[m] === 'number' && same(table[m], a.value))
    .map(([m]) => m)
    .sort();
}

export function cleanLmeAuto(v: unknown): Record<string, LmeAutoMark> {
  const out: Record<string, LmeAutoMark> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [m, a] of Object.entries(v as Record<string, any>)) {
    if (/^\d{4}-\d{2}$/.test(m) && a && typeof a.value === 'number') out[m] = { value: a.value, final: !!a.final, days: Number(a.days) || 0, at: String(a.at ?? '') };
  }
  return out;
}

/** A priced document line / CI that used another LME than the month's final average. */
export interface ReviseCandidate {
  key: string;
  month: string;
  used: number;
  final: number;
  kind: 'CI' | 'INVOICE_1' | 'INVOICE_2' | 'INVOICE_SINGLE' | 'SGJP_IV_PL';
  ref: string; // "#19-2" / "#23"
  docLabel: string; // "Vedanta CI XP2652100123" / "Invoice #2 ADH-INV-2026-0004"
  orderId: string | null;
  shipmentId: string | null;
}

const KIND_LABEL: Record<ReviseCandidate['kind'], string> = { CI: 'Vedanta CI', INVOICE_1: 'Invoice #1', INVOICE_2: 'Invoice #2', INVOICE_SINGLE: 'Invoice', SGJP_IV_PL: 'SG→JP IV/PL' };
const usd = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthName = (m: string) => {
  const [y, mm] = m.split('-');
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mm) - 1]} ${y}`;
};

/** The task text: "#19-2: revise Vedanta CI — LME Sep 2026 is final at 3,276.82 (the CI used 3,250.00)". */
export function reviseTask(c: ReviseCandidate): { key: string; title: string; detail: string } {
  const verb = c.kind === 'CI' ? 'ask Vedanta for the revised CI' : `revise ${KIND_LABEL[c.kind]}`;
  return {
    key: `LME_REVISE:${c.key}`,
    title: `${c.ref}: ${verb} — LME ${monthName(c.month)} is final at ${usd(c.final)}`.slice(0, 200),
    detail: `${c.docLabel} used LME ${usd(c.used)} for ${monthName(c.month)} (provisional at the time); the month's cash-settlement average is now final at ${usd(c.final)} (Westmetall).`.slice(0, 500),
  };
}

export function differsFromFinal(used: unknown, final: number): used is number {
  return typeof used === 'number' && Number.isFinite(used) && !same(used, final);
}

export { KIND_LABEL as LME_DOC_LABEL, monthName as lmeMonthName };
