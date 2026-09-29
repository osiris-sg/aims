/**
 * Reading a delivery request the way staff actually type it in a group chat:
 *
 *   Tomorrow morning
 *   Company name :CNQC location:lentor garten delivery
 *   1 unit Lion 375
 *   60 es DG
 *   1 set 25 mm 5 core cable
 *
 * Pure functions only (no DB): date words, quantity lines, and the fuzzy
 * matchers for customer / project / catalog item. schedule_delivery feeds them
 * rows it has loaded and decides from the verdicts: ONE strong match is used,
 * several or none become a question for the user. Nothing here guesses.
 */

// ── Dates (Singapore time) ───────────────────────────────────────────────────

const SGT_MS = 8 * 3600_000;
const pad = (n: number) => String(n).padStart(2, '0');
export const sgtYmd = (now = new Date()) => new Date(now.getTime() + SGT_MS).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const dayOfWeek = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

export interface ParsedWhen {
  ymd: string;
  hh: number;
  mm: number;
  /** ISO-8601 with the +08:00 offset, ready for ScheduleDeliveryDto.scheduledFor. */
  iso: string;
  /** "Thu 1 Oct 2026, 9:00 am" for the card. */
  label: string;
  /** Where the time came from, so the card can say "(default)" when nobody said one. */
  timeFrom: 'word' | 'explicit' | 'default';
}

export const DEFAULT_HOUR = 9; // "morning", and the time used when none is given
export const AFTERNOON_HOUR = 14;

/**
 * "tomorrow morning" → next SGT day 09:00, "afternoon" → 14:00, weekday names,
 * "30 Sep", "30/9", ISO dates, "2pm", "14:30", "1400hrs". Day is required;
 * returns null when there is no day to be found (the tool then asks).
 * All arithmetic is on SGT calendar strings: no server-timezone Date maths.
 */
export function parseWhen(input: string, now = new Date()): ParsedWhen | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const today = sgtYmd(now);

  // A full ISO timestamp (the older tool contract sent scheduledFor this way).
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    const sgt = new Date(d.getTime() + SGT_MS).toISOString();
    return build(sgt.slice(0, 10), Number(sgt.slice(11, 13)), Number(sgt.slice(14, 16)), 'explicit');
  }

  const t = raw.toLowerCase().replace(/[,]/g, ' ').replace(/\s+/g, ' ');
  let ymd: string | null = null;

  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const dayMonth = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?\b/);
  const monthDay = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?\b/);
  const slash = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  const explicitDate = (y: number | null, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    let year = y ?? Number(today.slice(0, 4));
    let out = `${year}-${pad(m)}-${pad(d)}`;
    // No year and the date has passed: they mean next year's.
    if (y == null && out < today) out = `${++year}-${pad(m)}-${pad(d)}`;
    // Reject 31 Feb and friends.
    return new Date(`${out}T00:00:00Z`).toISOString().slice(0, 10) === out ? out : null;
  };

  if (iso) ymd = explicitDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  else if (dayMonth) ymd = explicitDate(dayMonth[3] ? Number(dayMonth[3]) : null, MONTHS[dayMonth[2].slice(0, 3)], Number(dayMonth[1]));
  else if (monthDay) ymd = explicitDate(monthDay[3] ? Number(monthDay[3]) : null, MONTHS[monthDay[1].slice(0, 3)], Number(monthDay[2]));
  else if (slash) {
    const y = slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : null;
    ymd = explicitDate(y, Number(slash[2]), Number(slash[1])); // Singapore writes D/M
  } else if (/\bday after (tomorrow|tmr|tmrw)\b/.test(t)) ymd = addDays(today, 2);
  else if (/\b(tomorrow|tmr|tmrw|tml|tmw|tomoro|tomolo)\b/.test(t)) ymd = addDays(today, 1);
  else if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(t)) ymd = today;
  else {
    const wd = t.match(/\b(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)\b/);
    if (wd) {
      const target = WEEKDAYS[wd[1]];
      // The coming one, never today: "Thursday" said on a Thursday means next week.
      const delta = (target - dayOfWeek(today) + 7) % 7 || 7;
      ymd = addDays(today, delta);
    }
  }
  if (!ymd) return null;

  // Time of day.
  const ampm = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/);
  const h24 = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const hrs = t.match(/\b([01]\d|2[0-3])([0-5]\d)\s*(?:hrs?|h)\b/);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (ampm[3] === 'pm') h += 12;
    return build(ymd, h, Number(ampm[2] || 0), 'explicit');
  }
  if (h24) return build(ymd, Number(h24[1]), Number(h24[2]), 'explicit');
  if (hrs) return build(ymd, Number(hrs[1]), Number(hrs[2]), 'explicit');
  if (/\bafternoon\b/.test(t)) return build(ymd, AFTERNOON_HOUR, 0, 'word');
  if (/\b(noon|lunch ?time)\b/.test(t)) return build(ymd, 12, 0, 'word');
  if (/\bmorning\b/.test(t)) return build(ymd, DEFAULT_HOUR, 0, 'word');
  return build(ymd, DEFAULT_HOUR, 0, 'default');
}

function build(ymd: string, hh: number, mm: number, timeFrom: ParsedWhen['timeFrom']): ParsedWhen {
  const iso = `${ymd}T${pad(hh)}:${pad(mm)}:00+08:00`;
  const day = new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return { ymd, hh, mm, iso, label: `${day}, ${h12}:${pad(mm)} ${hh < 12 ? 'am' : 'pm'}`, timeFrom };
}

// ── Item lines ───────────────────────────────────────────────────────────────

// Counting words that sit between the quantity and the item ("1 unit Lion 375",
// "60 es DG", "1 set 25 mm 5 core cable").
const COUNT_UNIT = /^(units?|sets?|pcs?|pieces?|nos?\.?|es|ea|each|lots?|rolls?|pairs?|x)$/i;
// Measurement units: "25 mm cable" starts with a size, not a quantity.
const MEASURE = '(?:mm|cm|m|mtr|meters?|metres?|core|kva|kw|a|amps?|v|l|ltr|litres?|liters?|ft|in|inch|hp|kg|tons?|t)';
const MEASURE_RE = new RegExp(`^${MEASURE}$`, 'i');

export interface ParsedLine {
  raw: string;
  quantity: number;
  /** The item text with the quantity and counting word removed. */
  text: string;
}

export function parseLine(input: string): ParsedLine {
  const raw = String(input || '').replace(/^\s*[-•*·]\s*/, '').trim();
  const words = raw.split(/\s+/).filter(Boolean);
  const lead = words[0]?.match(/^(\d+(?:\.\d+)?)(x)?$/i);
  if (lead && words.length > 1 && !MEASURE_RE.test(words[1])) {
    const rest = words.slice(1);
    if (!lead[2] && COUNT_UNIT.test(rest[0]) && rest.length > 1) rest.shift();
    return { raw, quantity: Number(lead[1]), text: rest.join(' ') };
  }
  const tail = raw.match(/^(.*\S)\s*[x×]\s*(\d+)$/i);
  if (tail) return { raw, quantity: Number(tail[2]), text: tail[1].trim() };
  return { raw, quantity: 1, text: raw };
}

// ── Normalising + fuzzy tokens ───────────────────────────────────────────────

export const norm = (s: any) =>
  String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
export const compact = (s: any) => norm(s).replace(/ /g, '');
/** "25 mm" → "25mm", "5 core" → "5core", so sizes compare as one token. */
const joinMeasures = (s: string) => s.replace(new RegExp(`\\b(\\d+(?:\\.\\d+)?) ?${MEASURE}\\b`, 'gi'), (m) => m.replace(/ /g, ''));
export const tokens = (s: any) => joinMeasures(norm(s)).split(' ').filter(Boolean);

export function lev(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** One typed token against one stored token. Anything with a digit must match
 *  exactly (375 is not 376); words may differ by one letter ("garten"/"garden")
 *  or be a prefix of each other ("cable"/"cables") once they are 4+ letters. */
export function tokenHit(q: string, t: string): boolean {
  if (q === t) return true;
  if (/\d/.test(q) || /\d/.test(t)) return false;
  if (q.length < 4 || t.length < 4) return false;
  return t.startsWith(q) || q.startsWith(t) || lev(q, t, 1) <= 1;
}

// ── Customers ────────────────────────────────────────────────────────────────

const CORP = new Set(['pte', 'ltd', 'private', 'limited', 'llp', 'inc', 'co', 'corp', 'corporation', 'company', 'the', 'sdn', 'bhd', 'plc']);
const coreOf = (s: any) => norm(s).split(' ').filter((w) => w && !CORP.has(w)).join(' ');

export interface CustomerRow { id: string; name: string; customerCode: string | null }

/** Name, name without "Pte Ltd", customer code (the short name), the acronym,
 *  anything in brackets, and the first word when it is a code-like name
 *  ("CNQC Engineering & Construction" answers to "CNQC"). */
export function customerAliases(c: { name: string; customerCode?: string | null }): Set<string> {
  const core = coreOf(c.name);
  const words = core.split(' ').filter((w) => w && w !== 'and');
  const out = new Set<string>([norm(c.name), core, compact(core)].filter(Boolean));
  if (c.customerCode) {
    out.add(norm(c.customerCode));
    out.add(compact(c.customerCode));
  }
  if (words.length >= 2) out.add(words.map((w) => w[0]).join(''));
  if (words[0] && words[0].length >= 3) out.add(words[0]);
  for (const m of String(c.name).matchAll(/\(([^)]+)\)/g)) out.add(compact(m[1]));
  out.delete('');
  return out;
}

export type Match<T> = { kind: 'one'; row: T } | { kind: 'several'; rows: T[] } | { kind: 'none'; suggestions: T[] };

export function matchCustomer<T extends CustomerRow>(text: string, rows: T[]): Match<T> {
  const q = coreOf(text);
  const qc = q.replace(/ /g, '');
  if (!qc) return { kind: 'none', suggestions: [] };
  const strong = rows.filter((c) => {
    const core = coreOf(c.name);
    const aliases = customerAliases(c);
    return aliases.has(q) || aliases.has(qc) || (q.length >= 4 && ` ${core} `.includes(` ${q} `));
  });
  if (strong.length === 1) return { kind: 'one', row: strong[0] };
  if (strong.length > 1) return { kind: 'several', rows: strong };
  const weak = rows
    .map((c) => {
      const cc = compact(coreOf(c.name));
      const d = Math.min(lev(qc, cc, 2), ...[...customerAliases(c)].map((a) => lev(qc, a, 2)));
      const contains = qc.length >= 3 && cc.includes(qc);
      return { c, score: contains ? 0 : d };
    })
    .filter((x) => x.score <= 2)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.c);
  return { kind: 'none', suggestions: weak.slice(0, 5) };
}

/** Does a stored order's customer (free text or {id,name}) mean this customer? */
export function sameCustomer(customer: { id: string; name: string; customerCode?: string | null }, stored: any): boolean {
  const id = stored?.customerId ?? stored?.customer?.id;
  if (id && id === customer.id) return true;
  const c = stored?.customer;
  const name = typeof c === 'string' ? c : c?.name || c?.customerName || stored?.customerName || '';
  const a = coreOf(name);
  if (!a) return false;
  const b = coreOf(customer.name);
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (` ${b} `.includes(` ${a} `) || ` ${a} `.includes(` ${b} `))) return true;
  return customerAliases(customer).has(compact(a));
}

// ── Projects / sites ─────────────────────────────────────────────────────────

const LOC_STOP = new Set(['at', 'the', 'site', 'delivery', 'deliver', 'project', 'job', 'location', 'to', 'for', 'area']);

export interface ProjectRow { id: string; name: string; address: string | null }

function coverage(q: string[], pool: string[]): number {
  if (!q.length) return 0;
  return q.filter((qt) => pool.some((pt) => tokenHit(qt, pt))).length / q.length;
}

/** "lentor garten" against a customer's projects, by name and site address. */
export function matchProject<T extends ProjectRow>(text: string, rows: T[]): Match<T> {
  const q = tokens(text).filter((w) => !LOC_STOP.has(w));
  if (!q.length) return { kind: 'none', suggestions: [] };
  const scored = rows.map((p) => ({
    p,
    byName: coverage(q, tokens(p.name)),
    any: coverage(q, [...tokens(p.name), ...tokens(p.address), compact(p.name)]),
  }));
  const full = scored.filter((x) => x.any === 1);
  if (full.length === 1) return { kind: 'one', row: full[0].p };
  if (full.length > 1) {
    // Several read right; the ones whose NAME alone reads right win.
    const byName = full.filter((x) => x.byName === 1);
    if (byName.length === 1) return { kind: 'one', row: byName[0].p };
    return { kind: 'several', rows: (byName.length ? byName : full).map((x) => x.p) };
  }
  const partial = scored.filter((x) => x.any >= 0.5).sort((a, b) => b.any - a.any).map((x) => x.p);
  return { kind: 'none', suggestions: partial.slice(0, 5) };
}

// ── Catalog items ────────────────────────────────────────────────────────────

export interface AssetRow { id: string; name: string; skuKey: string | null }

export type ItemVerdict<T> = { kind: 'sure'; asset: T } | { kind: 'unsure'; options: T[] } | { kind: 'none' };

const ITEM_STOP = new Set(['the', 'of', 'and', 'for', 'with', 'a', 'an']);

/**
 * Sure only when the text IS the item (name or code, ignoring spaces and
 * punctuation: "Lion 375" = LION375), or covers every word of exactly one item
 * without that item carrying a size the text did not say. "25 mm 5 core cable"
 * vs "Cable Set 10m 25mm 5core" leaves the 10m unsaid → "Did you mean …?".
 * Nothing close → free-typed.
 */
export function matchItem<T extends AssetRow>(text: string, assets: T[]): ItemVerdict<T> {
  const c = compact(text);
  if (!c) return { kind: 'none' };
  const exact = assets.filter((a) => compact(a.name) === c || (a.skuKey && compact(a.skuKey) === c));
  if (exact.length === 1) return { kind: 'sure', asset: exact[0] };
  if (exact.length > 1) return { kind: 'unsure', options: exact.slice(0, 3) };

  const q = tokens(text).filter((w) => !ITEM_STOP.has(w));
  if (!q.length) return { kind: 'none' };
  const rows = assets.map((a) => {
    const own = [...tokens(a.name), ...tokens(a.skuKey)];
    const pool = [...own, compact(a.name), compact(a.skuKey)].filter(Boolean);
    const code = compact(a.skuKey);
    const containsCode = code.length >= 4 && c.includes(code);
    const cov = containsCode ? 1 : coverage(q, pool);
    const extraSizes = own.filter((t) => /\d/.test(t) && !q.includes(t) && !(containsCode && code.includes(t)));
    return { a, cov, extraSizes };
  });
  const full = rows.filter((r) => r.cov === 1).sort((x, y) => x.extraSizes.length - y.extraSizes.length);
  if (full.length === 1 && full[0].extraSizes.length === 0) return { kind: 'sure', asset: full[0].a };
  if (full.length) return { kind: 'unsure', options: full.slice(0, 3).map((r) => r.a) };
  // Close but not certain: half the words land, or a word begins the item's
  // code ("lion" → LION375, LION500). Offered as "Did you mean …?".
  const looseHit = (t: string, p: string) => tokenHit(t, p) || (!/\d/.test(t) && t.length >= 3 && p.startsWith(t));
  const near = rows
    .map((r) => {
      const pool = [...tokens(r.a.name), ...tokens(r.a.skuKey)];
      return { ...r, loose: q.filter((t) => pool.some((p) => looseHit(t, p))).length / q.length };
    })
    .filter((r) => r.loose >= 0.5 && q.some((t) => (t.length >= 3 || /\d/.test(t)) && [...tokens(r.a.name), ...tokens(r.a.skuKey)].some((p) => looseHit(t, p))))
    .sort((x, y) => y.loose - x.loose);
  return near.length ? { kind: 'unsure', options: near.slice(0, 3).map((r) => r.a) } : { kind: 'none' };
}

/** Does one line of a stored order cover this catalog item? */
export function orderLineCovers(line: any, asset: AssetRow): boolean {
  if (!line) return false;
  for (const k of ['inventoryItemId', 'assetId', 'itemId']) if (line[k] && line[k] === asset.id) return true;
  const code = compact(asset.skuKey);
  if (code && compact(line.itemCode) === code) return true;
  const d = compact(line.description);
  if (!d) return false;
  return (code.length >= 4 && d.includes(code)) || (compact(asset.name).length >= 4 && d.includes(compact(asset.name)));
}
