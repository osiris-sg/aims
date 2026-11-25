/**
 * Google Calendar -> AIMS import (WCT group, 2026-11-25): pure helpers shared by scripts/wct-gcal-import.ts.
 *  - ICS reading (folded lines, TZID / UTC / all-day dates) and recurrence expansion (DAILY / WEEKLY / MONTHLY /
 *    YEARLY with INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY; EXDATE).
 *  - The WCT title pattern "<marks><Name> @ <Address> (<Job title>) - <Team / workers> *<remarks>*" and the
 *    "Name. Address (Job) - Team" variant.
 *  - Classification (job / leave / blockage / general note), quotation numbers, customer / worker matching.
 * No I/O here. Tests: npx jest --rootDir . scripts/gcal/gcal-title.spec.ts --maxWorkers=2
 */

// ───────────────────────────── ICS ─────────────────────────────

export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  /** yyyy-MM-dd (Singapore) */
  startDate: string;
  endDate: string; // inclusive
  allDay: boolean;
  startTime: string | null; // HH:mm Singapore
  endTime: string | null;
  lastModified: string | null; // ISO
  rrule: string | null;
  exdates: string[]; // yyyyMMdd
  recurrenceId: string | null; // yyyyMMdd of an overridden instance
  status: string | null;
  props: Record<string, string>; // X-* and others as read
}

const unfold = (t: string) => t.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
export const icsUnescape = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
export const icsEscape = (s: string) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

const SG_OFFSET_MIN = 8 * 60;
const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
};

/** An ICS date-time value as Singapore date + time (all-day = VALUE=DATE). */
export function icsWhen(params: string, value: string): { date: string; time: string | null; allDay: boolean } {
  if (/VALUE=DATE(?!-)/.test(params) || /^\d{8}$/.test(value)) return { date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`, time: null, allDay: true };
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) throw new Error(`Bad ICS date ${value}`);
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  // UTC values move to Singapore; TZID values are taken as Singapore (the export's zone; WCT is SG only).
  if (m[7] === 'Z') t += SG_OFFSET_MIN * 60000;
  const d = new Date(t);
  return { date: ymd(d), time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`, allDay: false };
}

export function parseIcs(text: string): IcsEvent[] {
  const out: IcsEvent[] = [];
  const lines = unfold(text).split('\n');
  let cur: Record<string, Array<{ params: string; value: string }>> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT' && cur) {
      const g = (k: string) => cur![k]?.[0];
      const s = g('DTSTART');
      if (!s) { cur = null; continue; }
      const start = icsWhen(s.params, s.value);
      const e = g('DTEND');
      let end = e ? icsWhen(e.params, e.value) : start;
      // All-day DTEND is exclusive.
      const endDate = end.allDay && e ? addDays(end.date, -1) : end.date;
      const props: Record<string, string> = {};
      for (const [k, v] of Object.entries(cur)) props[k] = icsUnescape(v[0].value);
      const lm = g('LAST-MODIFIED')?.value;
      const rid = g('RECURRENCE-ID');
      out.push({
        uid: g('UID')?.value ?? '',
        summary: icsUnescape(g('SUMMARY')?.value ?? ''),
        description: icsUnescape(g('DESCRIPTION')?.value ?? ''),
        location: icsUnescape(g('LOCATION')?.value ?? ''),
        startDate: start.date,
        endDate: endDate < start.date ? start.date : endDate,
        allDay: start.allDay,
        startTime: start.time,
        endTime: end.allDay ? null : end.time,
        lastModified: lm ? lm.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z') : null,
        rrule: g('RRULE')?.value ?? null,
        exdates: (cur['EXDATE'] ?? []).flatMap((x) => x.value.split(',')).map((v) => v.slice(0, 8)),
        recurrenceId: rid ? icsWhen(rid.params, rid.value).date.replace(/-/g, '') : null,
        status: g('STATUS')?.value ?? null,
        props,
      });
      cur = null;
      continue;
    }
    if (!cur) continue;
    const m = line.match(/^([A-Z][A-Z0-9-]*)((?:;[^:]*)?):(.*)$/);
    if (!m) continue;
    (cur[m[1]] ||= []).push({ params: m[2], value: m[3] });
  }
  return out;
}

const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Start dates (yyyy-MM-dd) of a recurring event's instances from its start up to `until` (inclusive). */
export function expandRrule(startDate: string, rrule: string, until: string, max = 2000): string[] {
  const r: Record<string, string> = {};
  for (const p of rrule.split(';')) { const [k, v] = p.split('='); r[k] = v; }
  const freq = r.FREQ;
  const interval = Math.max(1, Number(r.INTERVAL || 1));
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const ruleUntil = r.UNTIL ? `${r.UNTIL.slice(0, 4)}-${r.UNTIL.slice(4, 6)}-${r.UNTIL.slice(6, 8)}` : null;
  const last = ruleUntil && ruleUntil < until ? ruleUntil : until;
  const out: string[] = [];
  const byDay = r.BYDAY ? r.BYDAY.split(',').map((x) => x.replace(/^[+-]?\d+/, '')) : null;
  const byMonthDay = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : null;
  const s = new Date(`${startDate}T00:00:00Z`);
  let n = 0;
  const push = (d: string) => {
    if (d < startDate || d > last || n >= count || out.length >= max) return false;
    out.push(d);
    n++;
    return true;
  };
  if (freq === 'DAILY') {
    for (let d = startDate; d <= last && n < count && out.length < max; d = addDays(d, interval)) push(d);
  } else if (freq === 'WEEKLY') {
    const days = byDay ? byDay.map((x) => DOW.indexOf(x)).filter((x) => x >= 0).sort() : [s.getUTCDay()];
    const weekStart = addDays(startDate, -s.getUTCDay());
    for (let w = weekStart; w <= last && n < count && out.length < max; w = addDays(w, 7 * interval)) for (const dw of days) push(addDays(w, dw));
  } else if (freq === 'MONTHLY') {
    const mdays = byMonthDay ?? [s.getUTCDate()];
    for (let i = 0; n < count && out.length < max; i += interval) {
      const y = s.getUTCFullYear() + Math.floor((s.getUTCMonth() + i) / 12);
      const m = (s.getUTCMonth() + i) % 12;
      const first = `${y}-${pad(m + 1)}-01`;
      if (first > last) break;
      for (const md of mdays) {
        const d = new Date(Date.UTC(y, m, md));
        if (d.getUTCMonth() === m) push(ymd(d));
      }
    }
  } else if (freq === 'YEARLY') {
    for (let i = 0; n < count && out.length < max; i += interval) {
      const d = new Date(Date.UTC(s.getUTCFullYear() + i, s.getUTCMonth(), s.getUTCDate()));
      if (ymd(d) > last) break;
      if (d.getUTCDate() === s.getUTCDate()) push(ymd(d));
    }
  } else {
    push(startDate);
  }
  return out.sort();
}

// ───────────────────────────── title ─────────────────────────────

export const MARKS: Array<{ re: RegExp; key: string }> = [
  { re: /^(\d*)✅/u, key: 'do' },
  { re: /^❌/u, key: 'cancelled' },
  { re: /^⭕/u, key: 'postponed' },
  { re: /^📌/u, key: 'sticker' },
  { re: /^🟫/u, key: 'cod' },
  { re: /^🔴/u, key: 'ptw:Bala' },
  { re: /^🟡/u, key: 'ptw:Joyna' },
  { re: /^🟢/u, key: 'ptw:Kherry' },
  { re: /^✋/u, key: 'ptwPending' },
  { re: /^👍/u, key: 'ptwApproved' },
  { re: /^👎/u, key: 'ptwRejected' },
  { re: /^📝/u, key: 'memo' },
  { re: /^⭐/u, key: 'star' },
  { re: /^✨/u, key: 'star' },
];

/** Leading status marks off the title: ["do", "ptw:Bala"], and the rest. "2✅" = "do:2". */
export function takeMarks(title: string): { marks: string[]; rest: string } {
  const marks: string[] = [];
  let s = title.trim();
  for (let guard = 0; guard < 16; guard++) {
    s = s.replace(/^[\s\uFE0F]+/u, '');
    const hit = MARKS.find((m) => m.re.test(s));
    if (!hit) break;
    const mm = s.match(hit.re)!;
    marks.push(hit.key === 'do' && mm[1] ? `do:${mm[1]}` : hit.key);
    s = s.slice(mm[0].length);
  }
  return { marks, rest: s.replace(/^[\s\uFE0F]+/u, '').trim() };
}

export interface JobParts {
  name: string;
  address: string;
  jobTitle: string;
  team: string;
  remarks: string[];
  pattern: 'at' | 'dot' | 'addressOnly' | 'other';
}

/** "<Name> @ <Address> (<Job title>) - <Team / workers> *<remarks>*" (marks already taken off). */
export function splitJob(rest: string): JobParts {
  const remarks: string[] = [];
  let s = rest.replace(/\*([^*]*)\*/g, (_m, r: string) => {
    if (r.trim()) remarks.push(r.trim());
    return ' ';
  });
  s = s.replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();
  let name = '';
  let address = '';
  let jobTitle = '';
  let team = '';
  const close = s.lastIndexOf(')');
  const dash = s.indexOf(' - ', close >= 0 ? close : 0);
  let main = s;
  if (dash >= 0 && (close < 0 || dash > close)) {
    team = s.slice(dash + 3).trim();
    main = s.slice(0, dash).trim();
  } else if (close < 0) {
    const d2 = s.lastIndexOf(' - ');
    if (d2 > 0 && /@/.test(s.slice(0, d2))) {
      team = s.slice(d2 + 3).trim();
      main = s.slice(0, d2).trim();
    }
  }
  const jm = main.match(/\(((?:[^()]|\([^()]*\))*)\)\s*$/);
  if (jm) {
    jobTitle = jm[1].trim();
    main = main.slice(0, jm.index).trim();
  }
  let pattern: JobParts['pattern'] = 'other';
  if (/@/.test(main)) {
    const i = main.indexOf('@');
    name = main.slice(0, i).trim();
    address = main.slice(i + 1).trim();
    pattern = 'at';
  } else {
    const dot = main.match(/^(.+?(?:Pte\.? Ltd\.?|Ltd\.?|LLP|[A-Za-z)]))\. (.+)$/);
    if (dot && jobTitle) {
      name = dot[1].trim();
      address = dot[2].trim();
      pattern = 'dot';
    } else if (jobTitle) {
      address = main;
      pattern = 'addressOnly';
    }
  }
  return { name, address, jobTitle, team, remarks, pattern };
}

export type Kind = 'job' | 'leave' | 'blockage' | 'general';

/** Owner 2026-11-25: everything is work. 📅 / the leave calendar = leave, 🚫 = blockage, "@" or a (job) - team = job, else a general note. */
export function classify(title: string, calendarName: string, parts: JobParts): Kind {
  if (/^\s*📅/u.test(title) || /LEAVES/i.test(calendarName)) return 'leave';
  if (/🚫|\bblockage\b/iu.test(title)) return 'blockage';
  if (parts.pattern === 'at') return 'job';
  if ((parts.pattern === 'dot' || parts.pattern === 'addressOnly') && parts.team) return 'job';
  return 'general';
}

/** Quotation numbers in a text: Q-013442, Q013442 -> "Q-013442". */
export function quotationNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text || '').matchAll(/\bQ-?(\d{5,6})(?:-\d)?\b/g)) out.add(`Q-${m[1].padStart(6, '0')}`);
  return [...out];
}

/** Leave note pieces: "📅 - PANDI (UPL)" -> { staff: "PANDI", leaveType: "UPL" }. */
export function leaveParts(title: string): { staff: string; leaveType: string | null } {
  const t = title.replace(/^\s*📅\s*/u, '').replace(/^[-\s]+/, '').trim();
  const m = t.match(/^(.*?)\s*\(([A-Za-z]{2,4})\)\s*$/);
  return m ? { staff: m[1].trim(), leaveType: m[2].toUpperCase() } : { staff: t, leaveType: null };
}

/** The "(Day 2 of 6)" / "(Day 2/6)" Google adds to multi-day events in its views. */
export const stripDayCounter = (t: string) => t.replace(/\s*\(Day \d+ (?:of|\/) ?\d+\)\s*$/i, '').trim();

// ───────────────────────────── matching ─────────────────────────────

export const normCompany = (s: string) =>
  String(s || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b(pte|ltd|private|limited|llp|the|co|s)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function bigrams(s: string) {
  const r = new Map<string, number>();
  const t = ` ${s} `;
  for (let i = 0; i < t.length - 1; i++) r.set(t.slice(i, i + 2), (r.get(t.slice(i, i + 2)) || 0) + 1);
  return r;
}
export function dice(a: string, b: string) {
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, na = 0, nb = 0;
  for (const v of A.values()) na += v;
  for (const v of B.values()) nb += v;
  for (const [g, v] of A) inter += Math.min(v, B.get(g) || 0);
  return na + nb ? (2 * inter) / (na + nb) : 0;
}

export interface CustomerRow { id: string; name: string; customerCode?: string | null }
export interface CustomerMatch { kind: 'exact' | 'close' | 'none'; score: number; customer: CustomerRow | null; nearest?: string }

export function customerIndex(customers: CustomerRow[]) {
  const byNorm = new Map<string, CustomerRow>();
  for (const c of customers) {
    const n = normCompany(c.name);
    if (n && !byNorm.has(n)) byNorm.set(n, c);
  }
  return byNorm;
}

/** Exact (same name, case / punctuation / "Pte Ltd" aside), then close (one name starts with the other, or 85% alike). */
export function matchCustomer(index: Map<string, CustomerRow>, name: string): CustomerMatch {
  const n = normCompany(name);
  if (!n) return { kind: 'none', score: 0, customer: null };
  const hit = index.get(n);
  if (hit) return { kind: 'exact', score: 1, customer: hit };
  let best: { score: number; c: CustomerRow } | null = null;
  for (const [cn, c] of index) {
    let sc = dice(n, cn);
    if (n.length >= 4 && (cn.startsWith(n + ' ') || n.startsWith(cn + ' '))) sc = Math.max(sc, 0.9);
    if (!best || sc > best.score) best = { score: sc, c };
  }
  if (best && best.score >= 0.85) return { kind: 'close', score: best.score, customer: best.c };
  return { kind: 'none', score: best?.score ?? 0, customer: null, nearest: best?.c.name };
}

export interface CrewSplit { teams: Array<{ id: string; name: string }>; workers: Array<{ id: string; name: string }>; typed: string[] }

/** "Team S + Vignesh + Pandi & Lakshman" -> teams / workers found in AIMS, the rest as typed. */
export function splitCrew(team: string, workers: Array<{ id: string; name: string }>, teams: Array<{ id: string; name: string }>): CrewSplit {
  const out: CrewSplit = { teams: [], workers: [], typed: [] };
  const pieces = String(team || '').split(/\s*(?:\+|&|,|\band\b)\s*/i).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  for (const p of pieces) {
    const k = p.toLowerCase();
    const t = teams.find((x) => x.name.toLowerCase() === k || x.name.toLowerCase() === `team ${k}`);
    if (t) { if (!out.teams.some((x) => x.id === t.id)) out.teams.push(t); continue; }
    const w = workers.find((x) => x.name.toLowerCase() === k) ?? workers.find((x) => x.name.toLowerCase().split(' ')[0] === k);
    if (w) { if (!out.workers.some((x) => x.id === w.id)) out.workers.push(w); continue; }
    out.typed.push(p);
  }
  return out;
}

/** The text of a Google event pop-up (Schedule view) -> its description (between "Description:" and the organiser block). */
export function popupDescription(txt: string | null | undefined): string {
  if (!txt) return '';
  const lines = txt.split('\n');
  const i = lines.findIndex((l) => l.trim() === 'Description:');
  if (i < 0) return '';
  const rest = lines.slice(i + 1);
  let end = rest.length;
  for (let j = 0; j < rest.length; j++) if (rest[j].trim() === 'event' && /^Organiser:|^Organizer:/.test(rest[j + 1] ?? '')) { end = j; break; }
  return rest.slice(0, end).join('\n').trim();
}
