/**
 * Email → order / shipment matching with auto-apply guards (2026-10, after a
 * hand review of the 18 prod suggestions: 2 wrong orders, 1 uncertain, 5
 * wrong planned actions — and every one of them had a B/L key, so "exact B/L
 * = auto" alone would have filed the wrong ones). Pure: the service loads the
 * records and the email's text, these rules decide.
 *
 * Keys are the orders' / shipments' OWN numbers found in the email (B/L core,
 * PI no., CI no.) — never a number the AI or a pattern merely guessed — with
 * WHERE each was found: the subject, an attachment (its name or content), or
 * the body (which carries quoted / forwarded text).
 *
 * PARTIAL_AUTO applies an email by itself only when ALL hold:
 *   a) exactly one exact key match to ONE shipment / order;
 *   b) that key is in the subject or an attachment — not only in the body;
 *   c) the subject's grade / size / qty / delivery-month / customer words agree with that order;
 *   d) no other order's key appears anywhere in the email;
 *   e) every planned action is one a step takes (checked by the service; fields are never overwritten).
 * Everything else stays a suggestion; subject cues alone never auto-apply.
 */
import { blCore } from '../shipments/trade-customs';
import { splitQuoted } from './email-quote';

/** Where a key was found. Round R: 'body' = the email's OWN text (strong); 'quoted' = the quoted history (weak). */
export type Where = 'subject' | 'attachment' | 'body' | 'quoted';

export interface EmailEvidence {
  subject: string;
  body: string;
  /** Each attachment's name and (first-page) text. */
  attachments: Array<{ name: string; text: string }>;
  /** For the delivery-month year ("11月納入" in an October email → this November). */
  date?: Date | null;
}

/** One shipment (or an order without shipments) the email can match. */
export interface MatchRecord {
  orderId: string;
  orderNo: number;
  orderStatus: string;
  shipmentId: string | null;
  seqNo: number | null;
  shipStatus: string | null;
  bl: string | null;
  piNo: string | null;
  ciNo: string | null;
  /** Customer profile key (KATO / SUS / HOEI) and name. */
  customerKey: string | null;
  customerName: string | null;
  grade: string | null;
  size: string | null;
  qtyMt: number | null;
  netMt: number | null;
  deliveryMonth: string | null;
  port: string | null;
}

export const recordRef = (r: Pick<MatchRecord, 'orderNo' | 'seqNo'>) => `#${r.orderNo}${r.seqNo ? `-${r.seqNo}` : ''}`;

// ── validators (wrong planned actions in the review) ─────────────────────────
/** Supplier CI numbers: Vedanta XP + 10 digits, or 9000xxxxxx (COMMERCIAL_INVOICE_9000…). Per-supplier extras are configurable. */
export const DEFAULT_CI_PATTERNS = ['^XP\\d{10}$', '^9000\\d{6}$'];

/** A CI no. only in a supplier format — never ADH's own SG→JP invoice no. (ADH20260928-…) or a carrier debit note (YOK-…, JPYOK_DebitNote…). */
export function validCiNo(v: string | null | undefined, patterns: string[] = DEFAULT_CI_PATTERNS): string | null {
  const s = (v ?? '').trim().toUpperCase();
  if (!s || /^ADH/.test(s) || /^(JP)?YOK/.test(s) || /DEBIT/.test(s)) return null;
  return patterns.some((p) => safeRe(p)?.test(s)) ? s : null;
}
const safeRe = (p: string) => {
  try {
    return new RegExp(p, 'i');
  } catch {
    return null;
  }
};

/** Contract no. only in a supplier's own form — Vedanta 4540xxxxx, plus a supplier profile's (SIAE_SC_xxxxxxxx) — never a B/L ("22AA198GX06003"). */
export const DEFAULT_CONTRACT_PATTERNS = ['^4540\\d{5}$'];
export const validContractNo = (v: string | null | undefined, patterns: string[] = DEFAULT_CONTRACT_PATTERNS): string | null => {
  const s = (v ?? '').trim();
  return s && patterns.some((p) => safeRe(p)?.test(s)) ? s : null;
};

/**
 * PI no.: a supplier profile's own format (SIAE_PI_xxxxxxxx) is recognised as that supplier's key; anything else
 * is kept as read (Vedanta's PI numbers were never validated). Returns the value and whether a pattern knew it.
 */
export function validPiNo(v: string | null | undefined, patterns: string[] = []): { value: string | null; known: boolean } {
  const s = (v ?? '').trim();
  if (!s) return { value: null, known: false };
  return { value: s, known: patterns.some((p) => safeRe(p)?.test(s)) };
}

// ── keys ─────────────────────────────────────────────────────────────────────
export interface KeyHit {
  kind: 'bl' | 'pi' | 'ci';
  value: string;
  orderId: string;
  /** null: an order-level key (PI). */
  shipmentId: string | null;
  where: Where[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The value inside the text, not inside a longer number (198GX06445 in "22AA198GX06445" counts; 27695632 in "276956322" doesn't). */
const contains = (text: string, value: string) => new RegExp(`(?<!\\d)${escapeRe(value)}(?!\\d)`, 'i').test(text);

/** Every record key (B/L core, PI no., supplier CI no.) the email names, and where. */
export function findKeyHits(ev: EmailEvidence, records: MatchRecord[], ciPatterns: string[] = DEFAULT_CI_PATTERNS): KeyHit[] {
  const { own, quoted } = splitQuoted(ev.body ?? '');
  const parts: Array<[Where, string]> = [
    ['subject', ev.subject ?? ''],
    ['attachment', ev.attachments.map((a) => `${a.name}\n${a.text ?? ''}`).join('\n')],
    ['body', own],
    ['quoted', quoted],
  ];
  const out: KeyHit[] = [];
  const add = (kind: KeyHit['kind'], value: string, orderId: string, shipmentId: string | null) => {
    const where = parts.filter(([, t]) => contains(t, value)).map(([w]) => w);
    if (!where.length || out.some((h) => h.kind === kind && h.value === value && h.shipmentId === shipmentId && h.orderId === orderId)) return;
    out.push({ kind, value, orderId, shipmentId, where });
  };
  for (const r of records) {
    const bl = r.bl ? blCore(r.bl) : '';
    if (bl.length >= 8) add('bl', bl, r.orderId, r.shipmentId);
    if (r.piNo && r.piNo.length >= 6) add('pi', r.piNo, r.orderId, null);
    const ci = validCiNo(r.ciNo, ciPatterns);
    if (ci) add('ci', ci, r.orderId, r.shipmentId);
  }
  return out;
}

/**
 * Round R: the record keys each attachment's OWN content (name + text) names — one email can file to several
 * shipments: a COA naming 198GX06445 goes to #21-1, a PL naming 198GX06520 to #22-1 (guard 1b per attachment).
 */
export function attachmentHits(ev: EmailEvidence, records: MatchRecord[], ciPatterns: string[] = DEFAULT_CI_PATTERNS): Array<{ index: number; hits: KeyHit[] }> {
  return ev.attachments.map((a, index) => ({ index, hits: findKeyHits({ subject: '', body: '', attachments: [a], date: ev.date }, records, ciPatterns) }));
}

/** The one record an attachment's content names (null when none or several orders). */
export function attachmentTarget(hits: KeyHit[]): { orderId: string; shipmentId: string | null; keyLabel: string } | null {
  const orders = [...new Set(hits.map((h) => h.orderId))];
  if (orders.length !== 1) return null;
  const ships = [...new Set(hits.map((h) => h.shipmentId).filter((x): x is string => !!x))];
  if (ships.length > 1) return null;
  const h = [...hits].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])[0];
  return { orderId: orders[0], shipmentId: ships[0] ?? null, keyLabel: `${KIND_LABEL[h.kind]} ${h.value}` };
}

// ── subject cues ─────────────────────────────────────────────────────────────
export interface SubjectCues {
  months: string[];
  grades: string[];
  inches: number[];
  qtys: number[];
  customers: string[];
  ports: string[];
  /** The subject names several products ("6005C 40T / 6063 HSB 32T / 6063 40T"). */
  multi: boolean;
}

const CUSTOMER_WORDS: Array<[RegExp, string]> = [
  [/加藤|kato/i, 'KATO'],
  [/\bSUS\b|エスユーエス/i, 'SUS'],
  [/豊栄|ホーエイ|\bhoei\b|\bhouei\b/i, 'HOEI'],
];
const PORT_WORDS: Array<[RegExp, string]> = [
  [/名古屋|nagoya/i, 'NAGOYA'],
  [/横浜|yokohama/i, 'YOKOHAMA'],
];

/** "11月納入" in an email of `date` → the nearest such month (this year, or next when it already passed by > 6 months). */
function deliveryMonthOf(m: number, date: Date | null | undefined): string {
  const d = date ?? new Date();
  let y = d.getUTCFullYear();
  const cur = d.getUTCMonth() + 1;
  if (m < cur - 6) y += 1;
  else if (m > cur + 6) y -= 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function subjectCues(subject: string | null | undefined, date?: Date | null): SubjectCues {
  const t = (subject ?? '').normalize('NFKC');
  const months = [...t.matchAll(/(\d{1,2})\s*月\s*納入/g)].map((m) => Number(m[1])).filter((m) => m >= 1 && m <= 12).map((m) => deliveryMonthOf(m, date));
  const grades = [...new Set([...t.matchAll(/(?<![\d.])(6\d{3}|1\d{3}|P1020|P0507)[A-Z]?(?!\d)/gi)].map((m) => m[1].toUpperCase()))];
  const inches = [
    ...[...t.matchAll(/(\d+(?:\.\d+)?)\s*(?:インチ|inch|in\b|")/gi)].map((m) => Number(m[1])),
    ...[...t.matchAll(/(?<!\d)(203|178|152|254)\s*(?:MM|ｍｍ)?(?!\d)/gi)].map((m) => Math.round(Number(m[1]) / 25.4)),
  ];
  const qtys = [...t.matchAll(/(?<![\d.])(\d{1,4}(?:\.\d+)?)\s*(?:MT|T|トン)(?![A-Za-z])/g)].map((m) => Number(m[1]));
  const customers = CUSTOMER_WORDS.filter(([re]) => re.test(t)).map(([, k]) => k);
  const ports = PORT_WORDS.filter(([re]) => re.test(t)).map(([, k]) => k);
  const segments = t.split(/[\/／、,]/).filter((s) => /(?<![\d.])(6\d{3}|1\d{3}|P1020)/i.test(s));
  // Several products: "6005C 40T / 6063 HSB 32T", or two grades / two quantities side by side ("6005C-8インチ 40T 6063…-6インチ 32T").
  const multi = segments.length > 1 || grades.length > 1 || (grades.length >= 1 && new Set(qtys).size > 1);
  return { months: [...new Set(months)], grades, inches: [...new Set(inches)], qtys, customers, ports, multi };
}

const grade4 = (g: string | null | undefined) => /P?\d{4}/i.exec(g ?? '')?.[0]?.toUpperCase() ?? null;
const inchOfSize = (s: string | null | undefined) => {
  const t = (s ?? '').normalize('NFKC');
  const i = /(\d+(?:\.\d+)?)\s*(?:インチ|inch|in\b|")/i.exec(t);
  if (i) return Number(i[1]);
  const mm = /(\d{3})\s*MM/i.exec(t);
  return mm ? Math.round(Number(mm[1]) / 25.4) : null;
};
const near = (q: number, x: number | null) => x !== null && x > 0 && Math.abs(q - x) <= Math.max(1, x * 0.1);

/** Subject words that disagree with this record (guard c). Words the subject doesn't have are never a conflict. */
export function cueConflicts(c: SubjectCues, r: MatchRecord): string[] {
  const out: string[] = [];
  const g = grade4(r.grade);
  if (c.grades.length && g && !c.grades.includes(g)) out.push(`grade ${c.grades.join('/')} ≠ ${g}`);
  const inch = inchOfSize(r.size);
  if (c.inches.length && inch !== null && !c.inches.some((x) => Math.abs(x - inch) <= 0.5)) out.push(`size ${c.inches.join('/')} inch ≠ ${inch} inch`);
  const knownQty = (r.netMt ?? 0) > 0 || (r.qtyMt ?? 0) > 0;
  if (c.qtys.length && knownQty && !c.qtys.some((q) => near(q, r.netMt) || near(q, r.qtyMt))) out.push(`qty ${c.qtys.join('/')} t ≠ ${[r.qtyMt, r.netMt].filter((x) => x !== null).join(' / ')} t`);
  if (c.months.length && r.deliveryMonth && !c.months.includes(r.deliveryMonth)) out.push(`delivery ${c.months.join('/')} ≠ ${r.deliveryMonth}`);
  if (c.customers.length && r.customerKey && !c.customers.includes(r.customerKey)) out.push(`customer ${c.customers.join('/')} ≠ ${r.customerKey}`);
  return out;
}

/** How well the subject describes this record: + per agreeing word, − per disagreeing one; with the reasons. */
export function cueScore(c: SubjectCues, r: MatchRecord): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const g = grade4(r.grade);
  if (c.grades.length && g) {
    if (c.grades.includes(g)) {
      score += 3;
      reasons.push(`grade ${g}`);
    } else score -= 3;
  }
  const inch = inchOfSize(r.size);
  if (c.inches.length && inch !== null) {
    if (c.inches.some((x) => Math.abs(x - inch) <= 0.5)) {
      score += 1;
      reasons.push(`${inch} inch`);
    } else score -= 1;
  }
  if (c.qtys.length && ((r.netMt ?? 0) > 0 || (r.qtyMt ?? 0) > 0)) {
    const q = c.qtys.find((x) => near(x, r.netMt) || near(x, r.qtyMt));
    if (q !== undefined) {
      score += 2;
      reasons.push(`${q} t`);
    } else score -= 2;
  }
  if (c.months.length && r.deliveryMonth) {
    if (c.months.includes(r.deliveryMonth)) {
      score += 2;
      reasons.push(`delivery ${r.deliveryMonth}`);
    } else score -= 2;
  }
  if (c.customers.length && r.customerKey) {
    if (c.customers.includes(r.customerKey)) {
      score += 3;
      reasons.push(r.customerKey);
    } else score -= 3;
  }
  if (c.ports.length && r.port && c.ports.includes(r.port.toUpperCase())) {
    score += 1;
    reasons.push(r.port);
  }
  return { score, reasons };
}

// ── the decision ─────────────────────────────────────────────────────────────

export interface Candidate {
  orderId: string;
  shipmentId: string | null;
  ref: string;
  score: number;
  reasons: string[];
}

/** Round T: which cue decided (see MATCH_PRIORITY). */
export type MatchSource = 'attachment' | 'own' | 'subject' | 'own-cues' | 'thread' | 'subject-cues' | null;

/**
 * Round T (2026-10-22, owner: "Pick shipment / subject disagrees is the main problem half the time"). The cues an
 * email carries decide in THIS order — the first that names one record wins, the rest only add notes:
 *   1. attachment hard key   a record's B/L / PI / CI in an attachment's name or content
 *   2. own-text hard key     the same in the email's OWN text (not the quoted history)
 *   3. subject hard key      the same in the subject (thread subjects go stale, so below the email's own words)
 *   4. own-text product cues grade / size / qty / month / customer words in the own text, when they fit one record
 *   5. thread link           the most recent accepted (or auto-applied) message of the thread; a combined thread
 *                            follows the one the own text (else a single-product subject) describes
 *   6. subject cues          tie-break only — a subject naming SEVERAL products is never a conflict and never decides
 *   7. quoted history        never decides; other orders' keys there are a note ("also mentions"), not a block
 * "Subject disagrees" (the CHECK chip) only when the subject names exactly ONE product AND its grade / size / qty /
 * customer contradicts a decision made by a hard key, own-text cues or the thread. Cues are normalised:
 * 6005C ≈ 6005 (grade4), 8インチ ≈ 203 MM (inchOfSize), 40T ≈ 40.271 t (near: ±10 %), 11月納入 ≈ 2026-11.
 */
export const MATCH_PRIORITY = ['attachment hard key', 'own-text hard key', 'subject hard key', 'own-text product cues', 'thread link', 'subject cues (tie-break)', 'quoted history (never decides)'] as const;

export interface MatchDecision {
  target: { orderId: string; shipmentId: string | null } | null;
  kind: 'pi' | 'bl' | 'ci' | 'thread' | 'cues' | null;
  confidence: 'exact' | 'thread' | 'cues' | 'none';
  /** PARTIAL_AUTO may apply it (guards a–d hold; e is checked on the plan). */
  auto: boolean;
  /** Which guard kept it a suggestion ("b: B/L 198GX06445 only in the quoted body"). */
  blocked: string[];
  /** Round T: REAL subject conflicts only (the "Check — subject disagrees" chip). Informational notes live in `notes`. */
  check: string[];
  /** Round T: what else the email mentions ("the subject names several products", "quoted text also names #16-1"). */
  notes: string[];
  /** Round T: which cue decided. */
  source: MatchSource;
  /** Several orders in one email: the ones it touches. */
  multiOrderIds: string[];
  candidates: Candidate[];
  /** "B/L 198GX04630" — what an auto-apply is labelled with in Processed. */
  keyLabel: string | null;
  /** Round P: one line saying how the match was found ("B/L 198GX… from an earlier email of this thread"). */
  reason: string | null;
  /** Round P, thread matches: inherited from an accepted / auto-applied message, or traced back to a key in an earlier message. */
  threadFrom?: 'accepted' | 'traced' | 'followed' | null;
}

/**
 * Round P: what the email's thread already knows (the service gathers it from the stored earlier messages —
 * Message-ID chain, else the same subject).
 *   accepted    an earlier message a person accepted (or PARTIAL_AUTO applied) — the thread's link
 *   traced      the EARLIEST message of the thread whose own subject / attachment names carry a record key
 *   candidates  the distinct orders / shipments the thread's messages are linked to (a combined thread covers
 *               several) — a reply naming only one product follows that one, else "pick the shipment"
 */
export interface ThreadContext {
  accepted: { orderId: string; shipmentId: string | null } | null;
  traced: { orderId: string; shipmentId: string | null; keyLabel: string; date: string | null } | null;
  candidates: Array<{ orderId: string; shipmentId: string | null }>;
}
/** The pre-round-P shape (an accepted earlier email) still works. */
export type ThreadInput = ThreadContext | { orderId: string; shipmentId: string | null } | null;
const threadContextOf = (t: ThreadInput): ThreadContext => (!t ? { accepted: null, traced: null, candidates: [] } : 'accepted' in t || 'traced' in t ? (t as ThreadContext) : { accepted: t as { orderId: string; shipmentId: string | null }, traced: null, candidates: [] });

const KIND_LABEL: Record<KeyHit['kind'], string> = { bl: 'B/L', pi: 'PI', ci: 'CI' };
const KIND_RANK: Record<KeyHit['kind'], number> = { pi: 0, bl: 1, ci: 2 };

/**
 * Round T: product cues in the email's OWN text — the same words as the subject's, but only grades that some
 * record actually has (a phone number or a B/L fragment is never a "grade").
 */
export function ownTextCues(own: string, records: MatchRecord[], date?: Date | null): SubjectCues {
  const c = subjectCues(own.slice(0, 4000), date);
  const known = new Set(records.map((r) => grade4(r.grade)).filter((g): g is string => !!g));
  const grades = c.grades.filter((g) => known.has(g));
  return { ...c, grades, multi: false };
}

/** The one record (order, and its shipment when exactly one) a set of hits names; null when none or several. */
function oneRecord(hits: KeyHit[]): { orderId: string; shipmentId: string | null; hit: KeyHit; several: 'orders' | 'shipments' | null } | null {
  const orders = [...new Set(hits.map((h) => h.orderId))];
  if (!orders.length) return null;
  const sorted = [...hits].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  if (orders.length > 1) return { orderId: orders[0], shipmentId: null, hit: sorted[0], several: 'orders' };
  const ships = [...new Set(hits.map((h) => h.shipmentId).filter((x): x is string => !!x))];
  return { orderId: orders[0], shipmentId: ships.length === 1 ? ships[0] : null, hit: sorted[0], several: ships.length > 1 ? 'shipments' : null };
}

/**
 * Pick the record and say whether it may be applied by itself — in the MATCH_PRIORITY order above.
 * Candidates: the top 3 by subject + own-text cues (a key hit adds 10), with reasons — the inbox picker shows them first.
 */
export function decideMatch(input: { ev: EmailEvidence; records: MatchRecord[]; hits: KeyHit[]; thread: ThreadInput }): MatchDecision {
  const { ev, records } = input;
  const thread = threadContextOf(input.thread);
  const cues = subjectCues(ev.subject, ev.date);
  const { own } = splitQuoted(ev.body ?? '');
  const ownCues = ownTextCues(own, records, ev.date);
  const recOf = (orderId: string, shipmentId: string | null) => records.find((r) => r.orderId === orderId && (shipmentId === null || r.shipmentId === shipmentId)) ?? null;
  const refOf = (orderId: string, shipmentId: string | null) => {
    const r = recOf(orderId, shipmentId);
    return r ? recordRef(r) : `#${records.find((x) => x.orderId === orderId)?.orderNo ?? '?'}`;
  };
  const live = records.filter((r) => r.orderStatus !== 'CANCELLED' && r.shipStatus !== 'CANCELLED');
  const at = (w: Where) => input.hits.filter((h) => h.where.includes(w));
  const strongHits = input.hits.filter((h) => h.where.some((w) => w !== 'quoted'));
  const quotedOnly = input.hits.filter((h) => h.where.length === 1 && h.where[0] === 'quoted');

  // Candidates (the picker's shortlist): subject cues + own-text cues, a key in the email adds 10.
  const scored = live
    .map((r) => {
      const s = cueScore(cues, r);
      const o = cueScore(ownCues, r);
      const mine = (h: KeyHit) => h.orderId === r.orderId && (h.shipmentId === null || h.shipmentId === r.shipmentId);
      const hitRow = strongHits.find(mine);
      const quotedRow = !hitRow ? quotedOnly.find(mine) : undefined;
      // Round U: say WHERE the key was found, so the picker makes the right one obvious.
      const whereLabel = (h: KeyHit) => (h.where.includes('attachment') ? 'in the attachment' : h.where.includes('body') ? 'in the email text' : h.where.includes('subject') ? 'in the subject' : 'only in quoted history');
      const keyReason = hitRow ? [`${KIND_LABEL[hitRow.kind]} ${hitRow.value} ${whereLabel(hitRow)}`] : quotedRow ? [`${KIND_LABEL[quotedRow.kind]} ${quotedRow.value} only in quoted history`] : [];
      const cueReasons = [...new Set([...o.reasons.map((x) => `${x} (text)`), ...s.reasons.map((x) => `${x} (subject)`)])];
      return { r, score: s.score + o.score + (hitRow ? 10 : quotedRow ? 2 : 0), reasons: [...keyReason, ...(!keyReason.length && cueReasons.length && !o.reasons.length ? ['subject only'] : []), ...cueReasons], open: r.orderStatus === 'OPEN' };
    })
    .sort((a, b) => b.score - a.score);
  const candidates: Candidate[] = scored.slice(0, 3).map((x) => ({ orderId: x.r.orderId, shipmentId: x.r.shipmentId, ref: recordRef(x.r), score: x.score, reasons: x.reasons }));
  const out: MatchDecision = { target: null, kind: null, confidence: 'none', auto: false, blocked: [], check: [], notes: [], source: null, multiOrderIds: [], candidates, keyLabel: null, reason: null, threadFrom: null };

  if (cues.multi) out.notes.push('the subject names several products (a combined thread) — it does not decide');
  const quotedOthers = (orderId: string | null) => [...new Set(quotedOnly.filter((h) => h.orderId !== orderId).map((h) => `#${records.find((r) => r.orderId === h.orderId)?.orderNo ?? '?'}`))];

  /** Subject conflicts (the CHECK chip): only a SINGLE-product subject can disagree; a month alone never contradicts a hard key. */
  const conflictsFor = (rec: MatchRecord | null, hardKey: boolean): string[] => {
    if (!rec || cues.multi) return [];
    const all = cueConflicts(cues, rec);
    return hardKey ? all.filter((c) => !/^delivery /.test(c)) : all;
  };
  const finish = (target: { orderId: string; shipmentId: string | null }, source: MatchSource, extra: { kind?: MatchDecision['kind']; confidence?: MatchDecision['confidence']; keyLabel?: string | null; reason: string; threadFrom?: MatchDecision['threadFrom']; hardKey: boolean }) => {
    out.target = target;
    out.source = source;
    out.kind = extra.kind ?? 'cues';
    out.confidence = extra.confidence ?? 'cues';
    out.keyLabel = extra.keyLabel ?? null;
    out.reason = extra.reason;
    out.threadFrom = extra.threadFrom ?? null;
    const rec = recOf(target.orderId, target.shipmentId);
    const conflicts = conflictsFor(rec, extra.hardKey);
    if (conflicts.length) {
      out.blocked.push(`c: the subject disagrees (${conflicts.join('; ')})`);
      out.check.push(...conflicts);
    }
    if (rec && cues.multi === false && cues.months.length && rec.deliveryMonth && !cues.months.includes(rec.deliveryMonth) && extra.hardKey) out.notes.push(`the subject's month (${cues.months.join('/')}) is not ${rec.deliveryMonth} — a stale thread subject`);
    // Guard d: another order's key in the subject / own text / an attachment (quoted history is a note only).
    const otherStrong = [...new Set(strongHits.filter((h) => h.orderId !== target.orderId).map((h) => `#${records.find((r) => r.orderId === h.orderId)?.orderNo ?? '?'}`))];
    if (otherStrong.length) {
      out.blocked.push(`d: another order's key is in the email (${otherStrong.join(', ')})`);
      out.notes.push(`also mentions ${otherStrong.join(', ')}`);
      out.multiOrderIds = [...new Set(strongHits.map((h) => h.orderId))];
    }
    const q = quotedOthers(target.orderId);
    if (q.length) out.notes.push(`the quoted text also names ${q.join(', ')}`);
    return out;
  };

  // 1–3. Hard keys: attachment, then own text, then subject.
  for (const [where, source, label] of [['attachment', 'attachment', 'attachment'], ['body', 'own', 'email text'], ['subject', 'subject', 'subject']] as Array<[Where, MatchSource, string]>) {
    const hits = at(where);
    const one = oneRecord(hits);
    if (!one) continue;
    if (one.several === 'orders') {
      // Several orders named in this one place: a later place may still decide (an attachment per shipment is the
      // service's splitByAttachment); here it is "pick".
      const refs = [...new Set(hits.map((h) => `#${records.find((r) => r.orderId === h.orderId)?.orderNo ?? '?'}`))];
      out.blocked.push(`a: keys of ${refs.length} orders in the ${label} (${refs.join(', ')})`);
      out.notes.push(`several orders in the ${label}: ${refs.join(', ')}`);
      out.multiOrderIds = [...new Set(hits.map((h) => h.orderId))];
      out.reason = `the ${label} names ${refs.join(', ')} — pick the order`;
      return out;
    }
    const target = { orderId: one.orderId, shipmentId: one.shipmentId };
    if (one.several === 'shipments') out.blocked.push(`a: keys of several shipments of ${refOf(one.orderId, null)} in the ${label}`);
    finish(target, source, { kind: one.hit.kind, confidence: 'exact', keyLabel: `${KIND_LABEL[one.hit.kind]} ${one.hit.value}`, reason: `${KIND_LABEL[one.hit.kind]} ${one.hit.value} is in the ${label}`, hardKey: true });
    out.auto = out.blocked.length === 0;
    return out;
  }
  // A key only in the quoted history: a note, never a decision (round T).
  if (quotedOnly.length) out.notes.push(`the quoted text names ${[...new Set(quotedOnly.map((h) => refOf(h.orderId, h.shipmentId)))].join(', ')} — not this email`);
  out.blocked.push('a: no exact B/L / PI / CI of a record in the email');

  // 4. Own-text product cues: the own text describes one record clearly.
  const ownScored = live.map((r) => ({ r, s: cueScore(ownCues, r) })).filter((x) => x.s.score > 0 && !cueConflicts(ownCues, x.r).length).sort((a, b) => b.s.score - a.s.score);
  const ownBest = ownScored[0];
  const ownClear = !!ownBest && ownBest.s.score >= 4 && ownBest.s.score - (ownScored[1]?.s.score ?? -99) >= 2;
  const threadCombined = thread.candidates.length > 1 ? thread.candidates : thread.candidates.length === 1 && thread.accepted && (thread.candidates[0].orderId !== thread.accepted.orderId || (thread.candidates[0].shipmentId ?? null) !== (thread.accepted.shipmentId ?? null)) ? [thread.accepted, ...thread.candidates] : [];
  if (ownClear && !threadCombined.length) {
    finish({ orderId: ownBest.r.orderId, shipmentId: ownBest.r.shipmentId }, 'own-cues', { kind: 'cues', confidence: 'cues', reason: `the email text describes ${recordRef(ownBest.r)} (${ownBest.s.reasons.join(', ')})`, hardKey: false });
    out.blocked.push(`a: matched by the email's own words (${ownBest.s.reasons.join(', ')}) — confirm`);
    return out;
  }

  // 5. The thread link. A combined thread follows the candidate the own text (else a single-product subject) describes.
  if (threadCombined.length > 1) {
    const refs = threadCombined.map((c) => refOf(c.orderId, c.shipmentId));
    const pick = (c: SubjectCues) =>
      threadCombined
        .map((cand) => ({ cand, rec: recOf(cand.orderId, cand.shipmentId) }))
        .filter(({ rec }) => rec && !cueConflicts(c, rec).length && cueScore(c, rec).score > 0)
        .map(({ cand, rec }) => ({ cand, s: cueScore(c, rec!) }))
        .sort((a, b) => b.s.score - a.s.score);
    const byOwn = pick(ownCues);
    const bySubject = cues.multi ? [] : pick(cues);
    const agree = byOwn.length && (byOwn.length === 1 || byOwn[0].s.score > byOwn[1].s.score) ? byOwn : bySubject.length && (bySubject.length === 1 || bySubject[0].s.score > bySubject[1].s.score) ? bySubject : [];
    if (agree.length) {
      const how = agree === byOwn ? 'the email text' : 'the subject';
      finish(agree[0].cand, 'thread', { kind: 'thread', confidence: 'thread', threadFrom: 'followed', reason: `this thread covers ${refs.join(' / ')}; ${how} describes ${refOf(agree[0].cand.orderId, agree[0].cand.shipmentId)} (${agree[0].s.reasons.join(', ')})`, hardKey: false });
      out.blocked.push(`a: followed the thread's ${refOf(agree[0].cand.orderId, agree[0].cand.shipmentId)} by ${how} — confirm`);
      return out;
    }
    out.multiOrderIds = [...new Set(threadCombined.map((c) => c.orderId))];
    out.reason = `this thread covers ${refs.join(' / ')} — pick the shipment`;
    out.blocked.push(`a: pick the shipment (thread covers ${refs.join('/')})`);
    out.notes.push(`pick the shipment — the thread covers ${refs.join(' / ')}`);
    return out;
  }
  if (thread.accepted) {
    finish(thread.accepted, 'thread', { kind: 'thread', confidence: 'thread', threadFrom: 'accepted', reason: `an earlier email of this thread was linked to ${refOf(thread.accepted.orderId, thread.accepted.shipmentId)}`, hardKey: false });
    // Link-only auto (the service also requires: nothing to file). A reply that files documents stays "Confirm match".
    out.auto = out.check.length === 0 && !out.blocked.some((b) => /^d:/.test(b));
    return out;
  }
  if (thread.traced) {
    finish({ orderId: thread.traced.orderId, shipmentId: thread.traced.shipmentId }, 'thread', { kind: 'thread', confidence: 'thread', threadFrom: 'traced', keyLabel: thread.traced.keyLabel, reason: `${thread.traced.keyLabel} is in an earlier email of this thread${thread.traced.date ? ` (${thread.traced.date})` : ''}`, hardKey: false });
    out.blocked.push(`b: ${thread.traced.keyLabel} is in an earlier email of the thread, not in this one — confirm`);
    return out;
  }
  // Own cues with a single-link thread that was not accepted / traced (plain) — still the email's own words.
  if (ownClear) {
    finish({ orderId: ownBest.r.orderId, shipmentId: ownBest.r.shipmentId }, 'own-cues', { kind: 'cues', confidence: 'cues', reason: `the email text describes ${recordRef(ownBest.r)} (${ownBest.s.reasons.join(', ')})`, hardKey: false });
    out.blocked.push(`a: matched by the email's own words (${ownBest.s.reasons.join(', ')}) — confirm`);
    return out;
  }

  // 6. Subject cues: a single-product subject that clearly describes one open record (never auto).
  const open = scored.filter((x) => x.open);
  const subjScored = live.filter((r) => r.orderStatus === 'OPEN').map((r) => ({ r, s: cueScore(cues, r) })).sort((a, b) => b.s.score - a.s.score);
  const [best, second] = subjScored;
  if (!cues.multi && best && best.s.score >= 4 && best.s.score - (second?.s.score ?? -99) >= 2) {
    finish({ orderId: best.r.orderId, shipmentId: best.r.shipmentId }, 'subject-cues', { kind: 'cues', confidence: 'cues', reason: `the subject describes ${recordRef(best.r)} (${best.s.reasons.join(', ')})`, hardKey: false });
    out.notes.push(`matched by the subject only (${best.s.reasons.join(', ')})`);
    return out;
  }
  // 7. Quoted history: the LAST resort — one record named only in the quoted text is a weak suggestion ("confirm"),
  //    never applied by itself, and never above anything the email itself says.
  const quotedOne = oneRecord(quotedOnly);
  if (quotedOne && !quotedOne.several && !cues.multi) {
    finish({ orderId: quotedOne.orderId, shipmentId: quotedOne.shipmentId }, 'subject-cues', { kind: quotedOne.hit.kind, confidence: 'cues', keyLabel: `${KIND_LABEL[quotedOne.hit.kind]} ${quotedOne.hit.value}`, reason: `${KIND_LABEL[quotedOne.hit.kind]} ${quotedOne.hit.value} is only in the quoted text`, hardKey: false });
    out.source = null;
    out.blocked.push(`b: ${out.keyLabel} is only in the quoted / forwarded text`);
    return out;
  }
  if (cues.multi) {
    out.multiOrderIds = [...new Set(open.filter((x) => x.score > 0).slice(0, 3).map((x) => x.r.orderId))];
    out.reason = 'the subject names several products and nothing else says which — pick the shipment';
  } else out.reason = 'no record number in the email or its thread, and neither the text nor the subject fits one record';
  return out;
}

/**
 * Round U (2026-10-22, owner): how sure the decision is, for applying by itself —
 *   high    a hard key in an attachment or the email's own text, no subject conflict, no other order's key
 *   medium  a thread / cue decision that points where the thread's most recent accepted message points
 *   null    everything else (a combined thread with no cue, a real subject conflict, keys of several orders)
 * The service applies high and medium by itself ("Auto · reviewed …") when the org's reasoner flag is on, into
 * EMPTY slots only; the one-off prod script does the same for the backlog.
 */
export type AutoTier = 'high' | 'medium' | null;
export function autoTier(d: MatchDecision, thread: ThreadInput): AutoTier {
  if (!d.target || d.check.length) return null;
  if (d.blocked.some((b) => /^d:/.test(b))) return null;
  if (d.source === 'attachment' || d.source === 'own') return 'high';
  const t = threadContextOf(thread);
  if (!t.accepted) return null;
  const same = t.accepted.orderId === d.target.orderId && (t.accepted.shipmentId ?? null) === (d.target.shipmentId ?? null);
  return same && (d.source === 'thread' || d.source === 'subject-cues' || d.source === 'own-cues' || d.source === 'subject') ? 'medium' : null;
}

/**
 * A telex release code belongs to a shipment only when the email ties it to that B/L: the code is in the subject,
 * or in the same line / paragraph as the B/L. Otherwise it stays a "check" (a thread about three B/Ls).
 */
export function telexTiedTo(ev: EmailEvidence, code: string, bl: string | null): boolean {
  if (!code) return false;
  if (contains(ev.subject ?? '', code)) return true;
  const core = bl ? blCore(bl) : '';
  if (!core) return false;
  const texts = [ev.body ?? '', ...ev.attachments.map((a) => a.text ?? '')];
  for (const t of texts) {
    for (const para of t.split(/\n\s*\n/)) {
      if (!contains(para, code) || !contains(para, core)) continue;
      // Same line, or a short paragraph naming only this B/L.
      if (para.split(/\n/).some((line) => contains(line, code) && contains(line, core))) return true;
      const bls: string[] = para.match(/\d{3}[A-Z]{2}\d{5}/gi) ?? [];
      if (bls.every((b) => b.toUpperCase() === core)) return true;
    }
  }
  return false;
}
