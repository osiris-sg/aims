/**
 * Repeating jobs and notes (WCT group, 2026-11-25): RFC 5545 RRULE expansion, the Google Calendar way.
 * Pure helpers; dates are calendar days (yyyy-MM-dd) in Asia/Singapore, so no time zone maths happens here.
 *
 * Supported: FREQ DAILY / WEEKLY / MONTHLY / YEARLY, INTERVAL, COUNT, UNTIL, BYDAY (with ordinals: 3TU, -1FR),
 * BYMONTHDAY (negative = from the month's end), BYMONTH, BYSETPOS, WKST. EXDATE is the series' exdates list.
 */

export interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  until: string | null; // yyyy-MM-dd (inclusive)
  byDay: Array<{ n: number | null; wd: number }>; // wd 0 = Sunday
  byMonthDay: number[];
  byMonth: number[]; // 1..12
  bySetPos: number[];
  wkst: number; // 0 = Sunday, 1 = Monday
}

export const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth'];
const MAX_STEPS = 200_000;

const pad = (n: number) => String(n).padStart(2, '0');
export const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const addDays = (s: string, n: number) => {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
};
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // m 0-based
export const weekdayOf = (s: string) => toDate(s).getUTCDay();

/** UNTIL in any RFC form (20270331, 20270331T155959Z) -> the Singapore day it ends on. */
function untilDay(v: string): string | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  if (!m[4] || !m[7]) return `${m[1]}-${m[2]}-${m[3]}`;
  // A UTC instant: its Singapore day (+8h).
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + 8 * 3_600_000;
  return ymd(new Date(t));
}

/** "RRULE:FREQ=WEEKLY;BYDAY=WE" or "FREQ=WEEKLY;BYDAY=WE" -> Rule. Throws on anything it cannot honour. */
export function parseRule(raw: string): Rule {
  const s = String(raw ?? '').trim().replace(/^RRULE:/i, '');
  if (!s || s.length > 500) throw new Error('Repeat rule is empty or too long');
  const p: Record<string, string> = {};
  for (const part of s.split(';')) {
    const [k, v] = part.split('=');
    if (k && v !== undefined) p[k.trim().toUpperCase()] = v.trim().toUpperCase();
  }
  const freq = p.FREQ as Rule['freq'];
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) throw new Error(`Repeat rule: FREQ ${p.FREQ ?? '(none)'} is not supported`);
  const interval = p.INTERVAL ? Number(p.INTERVAL) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) throw new Error('Repeat rule: INTERVAL must be 1 to 999');
  const count = p.COUNT ? Number(p.COUNT) : null;
  if (count !== null && (!Number.isInteger(count) || count < 1 || count > 5000)) throw new Error('Repeat rule: COUNT must be 1 to 5000');
  const until = p.UNTIL ? untilDay(p.UNTIL) : null;
  if (p.UNTIL && !until) throw new Error('Repeat rule: UNTIL is not a date');
  const byDay = (p.BYDAY ? p.BYDAY.split(',') : []).map((x) => {
    const m = x.match(/^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/);
    if (!m) throw new Error(`Repeat rule: BYDAY ${x} is not a weekday`);
    return { n: m[1] ? Number(m[1]) : null, wd: WD.indexOf(m[2]) };
  });
  const nums = (k: string, lo: number, hi: number) =>
    (p[k] ? p[k].split(',') : []).map((x) => {
      const n = Number(x);
      if (!Number.isInteger(n) || n === 0 || n < lo || n > hi) throw new Error(`Repeat rule: ${k} ${x} is out of range`);
      return n;
    });
  for (const k of Object.keys(p)) if (!['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS', 'WKST'].includes(k)) throw new Error(`Repeat rule: ${k} is not supported`);
  return {
    freq,
    interval,
    count,
    until,
    byDay,
    byMonthDay: nums('BYMONTHDAY', -31, 31),
    byMonth: nums('BYMONTH', 1, 12),
    bySetPos: nums('BYSETPOS', -366, 366),
    wkst: p.WKST ? Math.max(0, WD.indexOf(p.WKST)) : 1,
  };
}

/** Rule -> RRULE text (no "RRULE:" prefix), in a stable key order. */
export function formatRule(r: Rule): string {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byMonth.length) parts.push(`BYMONTH=${r.byMonth.join(',')}`);
  if (r.byMonthDay.length) parts.push(`BYMONTHDAY=${r.byMonthDay.join(',')}`);
  if (r.byDay.length) parts.push(`BYDAY=${r.byDay.map((d) => `${d.n ?? ''}${WD[d.wd]}`).join(',')}`);
  if (r.bySetPos.length) parts.push(`BYSETPOS=${r.bySetPos.join(',')}`);
  if (r.wkst !== 1) parts.push(`WKST=${WD[r.wkst]}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  if (r.until) parts.push(`UNTIL=${r.until.replace(/-/g, '')}`);
  return parts.join(';');
}

/** The days of one month the rule picks (before BYSETPOS), ascending. */
function monthDays(r: Rule, y: number, m: number, start: string): number[] {
  const dim = daysInMonth(y, m);
  const out = new Set<number>();
  const md = r.byMonthDay.map((d) => (d > 0 ? d : dim + d + 1)).filter((d) => d >= 1 && d <= dim);
  if (r.byDay.length) {
    for (const bd of r.byDay) {
      const all: number[] = [];
      for (let d = 1; d <= dim; d++) if (new Date(Date.UTC(y, m, d)).getUTCDay() === bd.wd) all.push(d);
      if (bd.n === null) all.forEach((d) => out.add(d));
      else {
        const pick = bd.n > 0 ? all[bd.n - 1] : all[all.length + bd.n];
        if (pick) out.add(pick);
      }
    }
    if (md.length) for (const d of [...out]) if (!md.includes(d)) out.delete(d);
  } else if (md.length) md.forEach((d) => out.add(d));
  else {
    const sd = toDate(start).getUTCDate();
    if (sd <= dim) out.add(sd);
  }
  return [...out].sort((a, b) => a - b);
}

function setPos(list: string[], pos: number[]): string[] {
  if (!pos.length) return list;
  const out = new Set<string>();
  for (const p of pos) {
    const v = p > 0 ? list[p - 1] : list[list.length + p];
    if (v) out.add(v);
  }
  return [...out].sort();
}

/**
 * Every occurrence date of the rule from `start` (DTSTART) up to `to`, honouring COUNT / UNTIL from the start (so a
 * counted series counts from its first occurrence, whatever the range asked). exdates are left out AFTER counting
 * (as in RFC 5545). `from` limits what is returned.
 */
export function occurrences(rule: Rule | string, start: string, from: string, to: string, exdates: string[] = []): string[] {
  const r = typeof rule === 'string' ? parseRule(rule) : rule;
  if (!isYmd(start) || !isYmd(from) || !isYmd(to)) return [];
  const last = r.until && r.until < to ? r.until : to;
  const ex = new Set(exdates);
  const out: string[] = [];
  let n = 0;
  let steps = 0;
  const take = (d: string): boolean => {
    // false = stop.
    if (d < start) return true;
    if (d > last) return false;
    if (r.count !== null && n >= r.count) return false;
    n++;
    if (d >= from && !ex.has(d)) out.push(d);
    return true;
  };
  const s = toDate(start);
  if (r.freq === 'DAILY') {
    for (let d = start; d <= last && steps < MAX_STEPS; d = addDays(d, r.interval), steps++) {
      const dt = toDate(d);
      if (r.byMonth.length && !r.byMonth.includes(dt.getUTCMonth() + 1)) continue;
      if (r.byDay.length && !r.byDay.some((b) => b.wd === dt.getUTCDay())) continue;
      if (r.byMonthDay.length && !monthDays({ ...r, byDay: [] }, dt.getUTCFullYear(), dt.getUTCMonth(), start).includes(dt.getUTCDate())) continue;
      if (!take(d)) break;
    }
  } else if (r.freq === 'WEEKLY') {
    const days = r.byDay.length ? [...new Set(r.byDay.map((b) => b.wd))] : [s.getUTCDay()];
    // Days in week order from WKST.
    const order = days.map((wd) => ({ wd, off: (wd - r.wkst + 7) % 7 })).sort((a, b) => a.off - b.off);
    const weekStart = addDays(start, -((s.getUTCDay() - r.wkst + 7) % 7));
    outer: for (let w = weekStart; w <= last && steps < MAX_STEPS; w = addDays(w, 7 * r.interval), steps++) {
      const cands = order.map((o) => addDays(w, o.off)).filter((d) => !r.byMonth.length || r.byMonth.includes(toDate(d).getUTCMonth() + 1));
      for (const d of setPos(cands, r.bySetPos)) if (!take(d)) break outer;
    }
  } else if (r.freq === 'MONTHLY') {
    outer: for (let i = 0; steps < MAX_STEPS; i += r.interval, steps++) {
      const y = s.getUTCFullYear() + Math.floor((s.getUTCMonth() + i) / 12);
      const m = (s.getUTCMonth() + i) % 12;
      if (`${y}-${pad(m + 1)}-01` > last) break;
      if (r.byMonth.length && !r.byMonth.includes(m + 1)) continue;
      const cands = monthDays(r, y, m, start).map((d) => `${y}-${pad(m + 1)}-${pad(d)}`);
      for (const d of setPos(cands, r.bySetPos)) if (!take(d)) break outer;
    }
  } else {
    const months = r.byMonth.length ? [...r.byMonth].sort((a, b) => a - b) : [s.getUTCMonth() + 1];
    outer: for (let i = 0; steps < MAX_STEPS; i += r.interval, steps++) {
      const y = s.getUTCFullYear() + i;
      if (`${y}-01-01` > last) break;
      let cands: string[] = [];
      for (const mo of months) {
        // A yearly rule with no BYxxx keeps DTSTART's day (29 Feb only in leap years).
        cands.push(...monthDays(r, y, mo - 1, start).map((d) => `${y}-${pad(mo)}-${pad(d)}`));
      }
      cands = setPos(cands.sort(), r.bySetPos);
      for (const d of cands) if (!take(d)) break outer;
    }
  }
  return out;
}

/** The last occurrence date, or null when the series never ends. */
export function lastOccurrence(rule: Rule | string, start: string): string | null {
  const r = typeof rule === 'string' ? parseRule(rule) : rule;
  if (!r.count && !r.until) return null;
  const all = occurrences(r, start, start, r.until ?? '9999-12-31');
  return all.length ? all[all.length - 1] : start;
}

const fmtDay = (s: string) => {
  const d = toDate(s);
  return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const ordinalText = (n: number) => (n === -1 ? 'last' : n > 0 && n <= 5 ? ORD[n] : `${n}th`);

/** "Weekly on Wed, until 31 Mar 2027" / "Monthly on the third Tue, 10 times" / "Every 2 weeks on Mon, Fri, never ends". */
export function ruleText(rule: Rule | string, start: string): string {
  const r = typeof rule === 'string' ? parseRule(rule) : rule;
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[r.freq];
  const head = r.interval > 1 ? `Every ${r.interval} ${unit}s` : { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Annually' }[r.freq];
  let on = '';
  const weekdaysOnly = r.byDay.length === 5 && [1, 2, 3, 4, 5].every((w) => r.byDay.some((b) => b.wd === w && b.n === null));
  if (r.freq === 'WEEKLY' || (r.freq === 'DAILY' && r.byDay.length)) {
    const days = r.byDay.length ? r.byDay.map((b) => b.wd) : [weekdayOf(start)];
    on = weekdaysOnly ? ' on weekdays (Mon to Fri)' : ` on ${days.map((w) => WD_SHORT[w]).join(', ')}`;
  } else if (r.freq === 'MONTHLY' || r.freq === 'YEARLY') {
    const month = r.freq === 'YEARLY' ? ` of ${(r.byMonth.length ? r.byMonth : [toDate(start).getUTCMonth() + 1]).map((m) => MONTH_SHORT[m - 1]).join(', ')}` : '';
    if (r.byDay.length && (r.bySetPos.length || r.byDay.some((b) => b.n !== null))) {
      const pos = r.bySetPos.length ? r.bySetPos : [];
      on = ` on the ${r.byDay.map((b) => `${ordinalText(b.n ?? pos[0] ?? 1)} ${WD_SHORT[b.wd]}`).join(', ')}${month}`;
    } else if (r.byMonthDay.length) on = ` on day ${r.byMonthDay.map((d) => (d === -1 ? 'last' : String(d))).join(', ')}${month}`;
    else if (r.freq === 'YEARLY') on = ` on ${toDate(start).getUTCDate()} ${MONTH_SHORT[toDate(start).getUTCMonth()]}`;
    else on = ` on day ${toDate(start).getUTCDate()}`;
  }
  const end = r.until ? `, until ${fmtDay(r.until)}` : r.count ? `, ${r.count} time${r.count === 1 ? '' : 's'}` : ', never ends';
  return `${head}${on}${end}`;
}

/**
 * "This and following events" from `date`: the old series ends the day before, the new one starts on `date`. A COUNT
 * is shared out (the new series keeps what is left), an UNTIL stays on the new series.
 */
export function splitRule(rule: string, start: string, date: string): { before: string | null; after: string } {
  const r = parseRule(rule);
  const prior = occurrences(r, start, start, addDays(date, -1));
  const after: Rule = { ...r };
  if (r.count) after.count = Math.max(1, r.count - prior.length);
  // No occurrence left before the split: the old series goes.
  const before: Rule | null = prior.length ? { ...r, count: null, until: prior[prior.length - 1] } : null;
  return { before: before ? formatRule(before) : null, after: formatRule(after) };
}

/** The series cut to end the day before `date` ("delete this and following"); null = nothing left. */
export function endBefore(rule: string, start: string, date: string): string | null {
  return splitRule(rule, start, date).before;
}
