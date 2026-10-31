/**
 * Round AV — what an email (and its attachments) says EXACTLY about one shipment, for the Answer flow's
 * "+ New shipment" / edit drawer: B/L no., vessel / voyage, ETD / ETA, net / gross t, bundles, containers, CI no.
 *
 * Deterministic: only labelled values ("B/L No: 198GX06524", "VSL/VOY: WAN HAI 366/E051", "TOTAL NET WT (MT) :
 * 35.720", "INVOICE NO : XP2652102551") and self-checking keys (ISO 6346 container nos. with their check digit, the
 * org's CI patterns). A date counts only with its year and an unambiguous order (2026-10-28, 2026/10/28, 28 Oct
 * 2026, 28-OCT-26). Quoted history is left out. A field is PREFILLED only when every place that names it agrees;
 * several different values (a transhipment's two ETAs, two B/Ls in one email) come back as candidates only, never
 * as a value. The email is DATA: nothing in it is followed, only matched.
 */
import { validCiNo, DEFAULT_CI_PATTERNS } from './email-match.rules';

export const FACT_KEYS = ['blNumber', 'vessel', 'voyageNo', 'etd', 'eta', 'netWeightMt', 'grossWeightMt', 'totalBundles', 'containerCount', 'ciNumber'] as const;
export type FactKey = (typeof FACT_KEYS)[number];

/** One value and every place that names it: "subject", "email text" or the attachment's file name. */
export interface FactCandidate {
  value: string;
  sources: string[];
}
export interface FactField {
  /** Set only when every source agrees on one value. */
  value: string | null;
  candidates: FactCandidate[];
}
export interface ShipmentFacts {
  fields: Partial<Record<FactKey, FactField>>;
  /** Container numbers (ISO 6346, check digit verified) — the count goes to containerCount. */
  containers: string[];
}

export interface FactInput {
  subject: string | null;
  /** The sender's own text (quoted history already removed). */
  own: string;
  attachments: Array<{ name: string; text: string | null | undefined }>;
  ciPatterns?: string[];
}

const MONTHS: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12 };
const pad = (n: number) => String(n).padStart(2, '0');
const validYmd = (y: number, m: number, d: number) => {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/** A date only when its year and field order are certain; else null. */
export function exactDate(s: string): string | null {
  const t = s.trim().toUpperCase();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(t);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-\s./]?([A-Z]{3,4})[A-Z]*[-\s.,/]*(\d{4}|\d{2})\b/.exec(t);
  if (m && MONTHS[m[2]]) return validYmd(m[3].length === 2 ? 2000 + +m[3] : +m[3], MONTHS[m[2]], +m[1]);
  m = /^([A-Z]{3,4})[A-Z]*[-\s.]+(\d{1,2})(?:ST|ND|RD|TH)?[,\s]+(\d{4})\b/.exec(t);
  if (m && MONTHS[m[1]]) return validYmd(+m[3], MONTHS[m[1]], +m[2]);
  return null;
}

/** ISO 6346 check digit: owner (3 letters) + U/J/Z + 6 digits + check digit. */
export function validContainerNo(s: string): boolean {
  const c = s.toUpperCase();
  if (!/^[A-Z]{3}[UJZ]\d{7}$/.test(c)) return false;
  const val = (ch: string) => {
    if (/\d/.test(ch)) return Number(ch);
    let v = ch.charCodeAt(0) - 55; // A = 10
    // Multiples of 11 are skipped in the letter values.
    v += Math.floor((v - 1) / 10);
    return v;
  };
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += val(c[i]) * 2 ** i;
  return (sum % 11) % 10 === Number(c[10]);
}

const num = (raw: string) => {
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
/** Tonnes as a plain string ("35.72"); KG are converted. Unknown unit = not exact = null. */
const tonnes = (raw: string, unit: string | undefined | null): string | null => {
  const n = num(raw);
  if (n === null || n <= 0) return null;
  const u = (unit ?? '').toUpperCase().replace(/[\s.]/g, '');
  if (/^(MT|M\/T|T|TON|TONS|TONNES?|MTS)$/.test(u)) return String(Math.round(n * 1000) / 1000);
  if (/^KGS?$/.test(u)) return String(Math.round(n) / 1000);
  return null;
};

type Hit = { key: FactKey; value: string };

/** Every labelled fact in one text. */
export function factsIn(text: string, opts: { attachment: boolean; ciPatterns: string[] }): { hits: Hit[]; containers: string[] } {
  const hits: Hit[] = [];
  const add = (key: FactKey, value: string | null | undefined) => {
    const v = (value ?? '').trim();
    // A voyage number always has a digit (a B/L header's "VOYAGE NO. : PLACE OF …" is not one).
    if (key === 'voyageNo' && !/\d/.test(v)) return;
    if (v) hits.push({ key, value: v });
  };
  const all = text.replace(/\r/g, '');
  // A value sits on its label's own line: a label on one line and a number on the next (a table) is not exact.
  for (const T of all.split('\n')) factsInLine(T, add, opts);
  const containers = [...new Set([...all.toUpperCase().matchAll(/\b([A-Z]{3}[UJZ]\s?\d{6}\s?-?\s?\d)\b/g)].map((m) => m[1].replace(/[\s-]/g, '')).filter(validContainerNo))];
  return { hits, containers };
}

function factsInLine(T: string, add: (key: FactKey, value: string | null | undefined) => void, opts: { attachment: boolean; ciPatterns: string[] }) {

  // B/L no. — labelled; a real number has letters / digits and at least 5 digits.
  for (const m of T.matchAll(/\b(?:B\s*\/\s*L|BL|BILL\s+OF\s+LADING)\s*(?:NO\.?|NUMBER|#)?\s*[:：]?\s*([A-Z0-9]{8,20})\b/gi)) {
    const v = m[1].toUpperCase();
    if ((v.match(/\d/g) ?? []).length >= 5 && !/^(DRAFT|NUMBER)/.test(v)) add('blNumber', v);
  }
  // Vessel / voyage — "VSL/VOY: WAN HAI 366/E051", "VESSEL : WAN HAI 365", "VOYAGE : N045365".
  for (const m of T.matchAll(/\bVSL\s*\/\s*VOY(?:AGE)?\s*[:：]\s*([A-Z][A-Z0-9 .\-]{1,40}?)\s*\/\s*([A-Z0-9\-]{2,15})\b/gi)) {
    add('vessel', m[1].replace(/\s+/g, ' ').toUpperCase());
    add('voyageNo', m[2].toUpperCase());
  }
  for (const m of T.matchAll(/\b(?:VESSEL|VSL)(?:\s+NAME)?\s*[:：]\s*([A-Z][A-Z0-9 .\-]{1,40}?)(?=\s{2,}|\s*\/|\s+(?:B\s*\/\s*L|VOY|ETA|ETD|PORT|DATE)\b|[,;]|$)/gi)) add('vessel', m[1].replace(/\s+/g, ' ').toUpperCase());
  // Not the "VOY" of "VSL/VOY:" (read above as vessel / voyage).
  for (const m of T.matchAll(/(?<!\/\s*)\bVOY(?:AGE)?(?:\s+NO\.?)?\s*[:：]\s*([A-Z0-9\-]{2,15})\b/gi)) add('voyageNo', m[1].toUpperCase());
  // ETD / ETA — labelled, a full date right after the label.
  for (const m of T.matchAll(/\bE\.?T\.?([AD])\b\.?\s*(?:\([^)]{0,12}\))?\s*[:：]?\s*([0-9A-Za-z][0-9A-Za-z ,./\-]{5,20})/g)) {
    const d = exactDate(m[2]);
    if (d) add(m[1].toUpperCase() === 'A' ? 'eta' : 'etd', d);
  }
  // Net / gross — "TOTAL NET WT (MT) : 35.720", "NET WEIGHT: 20,416 KGS", "N.W. 20.416 MT".
  // NET / GROSS need their WT / WEIGHT word; N.W. / G.W. are labels on their own.
  const weight = /\b(?:TOTAL\s+)?(NET\s*(?:WT|WEIGHT|WGT)|GROSS\s*(?:WT|WEIGHT|WGT)|N\.\s?W|G\.\s?W)\.?\s*(?:\(\s*(M\s*\/?\s*T|MT|KGS?|TONS?)\s*\))?\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*(MTS?|M\/T|KGS?|TONS?|TONNES?|T)?\b/gi;
  for (const m of T.matchAll(weight)) {
    const kind = m[1].toUpperCase().replace(/[\s.]/g, '');
    const v = tonnes(m[3], m[2] ?? m[4]);
    if (v) add(kind.startsWith('N') ? 'netWeightMt' : 'grossWeightMt', v);
  }
  // Bundles — "TOTAL BUNDLES : 14"; in a document also "32 BUNDLE(S)".
  for (const m of T.matchAll(/\bTOTAL\s+(?:NO\.?\s+OF\s+)?BUNDLES?\s*[:：]?\s*(\d{1,5})\b/gi)) add('totalBundles', String(+m[1]));
  if (opts.attachment) for (const m of T.matchAll(/\b(\d{1,5})\s+BUNDLE\(?S\)?\b/g)) add('totalBundles', String(+m[1]));
  // CI no. — the org's CI patterns are exact keys wherever they appear.
  for (const m of T.matchAll(/\b[A-Z0-9]{6,20}\b/g)) {
    const ci = validCiNo(m[0], opts.ciPatterns);
    if (ci) add('ciNumber', ci);
  }
}

/** Merge the subject, the own text and every attachment; a field is a value only when all of them agree. */
export function shipmentFacts(input: FactInput): ShipmentFacts {
  const ciPatterns = input.ciPatterns?.length ? input.ciPatterns : DEFAULT_CI_PATTERNS;
  const byKey = new Map<FactKey, Map<string, Set<string>>>();
  const containers = new Map<string, Set<string>>();
  const take = (where: string, text: string | null | undefined, attachment: boolean) => {
    if (!text) return;
    const { hits, containers: cs } = factsIn(text, { attachment, ciPatterns });
    for (const h of hits) {
      const m = byKey.get(h.key) ?? new Map<string, Set<string>>();
      m.set(h.value, (m.get(h.value) ?? new Set()).add(where));
      byKey.set(h.key, m);
    }
    for (const c of cs) containers.set(c, (containers.get(c) ?? new Set()).add(where));
  };
  take('subject', input.subject, false);
  take('email text', input.own, false);
  for (const a of input.attachments) take(a.name, a.text, true);

  const fields: ShipmentFacts['fields'] = {};
  for (const [key, m] of byKey) {
    const candidates = [...m.entries()].map(([value, s]) => ({ value, sources: [...s] }));
    fields[key] = { value: candidates.length === 1 ? candidates[0].value : null, candidates };
  }
  const list = [...containers.keys()].sort();
  if (list.length) {
    const sources = [...new Set([...containers.values()].flatMap((s) => [...s]))];
    fields.containerCount = { value: String(list.length), candidates: [{ value: String(list.length), sources }] };
  }
  return { fields, containers: list };
}

/** Merge several emails' facts (a thread): same rule — prefilled only when they all agree. */
export function mergeFacts(all: ShipmentFacts[]): ShipmentFacts {
  const byKey = new Map<FactKey, Map<string, Set<string>>>();
  for (const f of all) {
    for (const [key, field] of Object.entries(f.fields) as Array<[FactKey, FactField]>) {
      if (key === 'containerCount') continue;
      const m = byKey.get(key) ?? new Map<string, Set<string>>();
      for (const c of field.candidates) m.set(c.value, new Set([...(m.get(c.value) ?? []), ...c.sources]));
      byKey.set(key, m);
    }
  }
  const containers = [...new Set(all.flatMap((f) => f.containers))].sort();
  const fields: ShipmentFacts['fields'] = {};
  for (const [key, m] of byKey) {
    const candidates = [...m.entries()].map(([value, s]) => ({ value, sources: [...s] }));
    fields[key] = { value: candidates.length === 1 ? candidates[0].value : null, candidates };
  }
  if (containers.length) {
    const sources = [...new Set(all.flatMap((f) => f.fields.containerCount?.candidates.flatMap((c) => c.sources) ?? []))];
    fields.containerCount = { value: String(containers.length), candidates: [{ value: String(containers.length), sources }] };
  }
  return { fields, containers };
}
