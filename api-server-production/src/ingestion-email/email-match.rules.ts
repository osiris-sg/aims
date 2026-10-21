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

export type Where = 'subject' | 'attachment' | 'body';

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
  const parts: Array<[Where, string]> = [
    ['subject', ev.subject ?? ''],
    ['attachment', ev.attachments.map((a) => `${a.name}\n${a.text ?? ''}`).join('\n')],
    ['body', ev.body ?? ''],
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

export interface MatchDecision {
  target: { orderId: string; shipmentId: string | null } | null;
  kind: 'pi' | 'bl' | 'ci' | 'thread' | 'cues' | null;
  confidence: 'exact' | 'thread' | 'cues' | 'none';
  /** PARTIAL_AUTO may apply it (guards a–d hold; e is checked on the plan). */
  auto: boolean;
  /** Which guard kept it a suggestion ("b: B/L 198GX06445 only in the quoted body"). */
  blocked: string[];
  /** Shown as a "check" chip. */
  check: string[];
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
 * Pick the record and say whether it may be applied by itself.
 *   1. Record keys: one order → that order (its single shipment when the keys name one); a key found only in the
 *      body whose order the subject contradicts is dropped (a quoted older B/L — "6005C 40T" on a 6063 B/L).
 *      Keys of several orders → the one whose key is in the subject / an attachment, if exactly one; else multi-order.
 *   2. No usable key: an ACCEPTED earlier email of the thread ("thread").
 *   3. Subject cues: the best-scoring open record when clearly ahead (≥ 4 and ≥ 2 above the next) ("cues").
 * Candidates: the top 3 by subject cues (a key hit adds 10), with reasons — the inbox picker shows them first.
 */
export function decideMatch(input: { ev: EmailEvidence; records: MatchRecord[]; hits: KeyHit[]; thread: ThreadInput }): MatchDecision {
  const { ev, records } = input;
  const thread = threadContextOf(input.thread);
  const cues = subjectCues(ev.subject, ev.date);
  const recOf = (orderId: string, shipmentId: string | null) => records.find((r) => r.orderId === orderId && (shipmentId === null || r.shipmentId === shipmentId)) ?? null;
  const strong = (h: KeyHit) => h.where.includes('subject') || h.where.includes('attachment');
  // A body-only key whose record the subject contradicts is a quoted older email, not this one.
  const hits = input.hits.filter((h) => {
    if (strong(h)) return true;
    const r = recOf(h.orderId, h.shipmentId);
    return !(r && cueConflicts(cues, r).length);
  });
  const dropped = input.hits.filter((h) => !hits.includes(h));

  const live = records.filter((r) => r.orderStatus !== 'CANCELLED' && r.shipStatus !== 'CANCELLED');
  const scored = live
    .map((r) => {
      const s = cueScore(cues, r);
      const hit = input.hits.some((h) => h.orderId === r.orderId && (h.shipmentId === null || h.shipmentId === r.shipmentId));
      return { r, score: s.score + (hit ? 10 : 0), reasons: [...(hit ? ['key in the email'] : []), ...s.reasons], open: r.orderStatus === 'OPEN' };
    })
    .sort((a, b) => b.score - a.score);
  const candidates: Candidate[] = scored.slice(0, 3).map((x) => ({ orderId: x.r.orderId, shipmentId: x.r.shipmentId, ref: recordRef(x.r), score: x.score, reasons: x.reasons }));

  const out: MatchDecision = { target: null, kind: null, confidence: 'none', auto: false, blocked: [], check: [], multiOrderIds: [], candidates, keyLabel: null, reason: null, threadFrom: null };
  const refOf = (orderId: string, shipmentId: string | null) => {
    const r = recOf(orderId, shipmentId);
    return r ? recordRef(r) : `#${records.find((x) => x.orderId === orderId)?.orderNo ?? '?'}`;
  };
  if (dropped.length) out.check.push(`ignored ${dropped.map((h) => `${KIND_LABEL[h.kind]} ${h.value}`).join(', ')} — only in the quoted body, and the subject describes another order`);
  if (cues.multi) out.check.push('the subject names several products — pick the shipment(s)');

  const orders = [...new Set(hits.map((h) => h.orderId))];
  // Guard d looks at EVERY key in the email — a quoted older B/L of another order still means "check".
  const allOrders = [...new Set(input.hits.map((h) => h.orderId))];
  if (orders.length) {
    let orderId: string | null = null;
    if (orders.length === 1) orderId = orders[0];
    else {
      const strongOrders = [...new Set(hits.filter(strong).map((h) => h.orderId))];
      out.multiOrderIds = orders;
      if (strongOrders.length === 1) {
        orderId = strongOrders[0];
        const others = orders.filter((o) => o !== orderId).map((o) => records.find((r) => r.orderId === o)?.orderNo);
        out.blocked.push(`d: another order's key is in the email (#${others.join(', #')})`);
        out.check.push(`also mentions #${others.join(', #')}`);
      } else {
        out.blocked.push(`a: keys of ${orders.length} orders (#${orders.map((o) => records.find((r) => r.orderId === o)?.orderNo).join(', #')})`);
        out.check.push(`several orders: #${orders.map((o) => records.find((r) => r.orderId === o)?.orderNo).join(', #')}`);
      }
    }
    if (orderId) {
      const mine = hits.filter((h) => h.orderId === orderId).sort((a, b) => Number(strong(b)) - Number(strong(a)) || KIND_RANK[a.kind] - KIND_RANK[b.kind]);
      // Several shipments of the order named: the one whose key is in the subject / an attachment, if only one is.
      const allShips = [...new Set(mine.map((h) => h.shipmentId).filter((x): x is string => !!x))];
      const strongShips = [...new Set(mine.filter(strong).map((h) => h.shipmentId).filter((x): x is string => !!x))];
      const ships = allShips.length > 1 && strongShips.length === 1 ? strongShips : allShips;
      const shipmentId = ships.length === 1 ? ships[0] : null;
      if (allShips.length > 1) out.blocked.push(`a: keys of ${allShips.length} shipments of the order`);
      out.target = { orderId, shipmentId };
      out.kind = mine[0].kind;
      out.confidence = 'exact';
      out.keyLabel = `${KIND_LABEL[mine[0].kind]} ${mine[0].value}`;
      out.reason = `${out.keyLabel} is in the ${mine[0].where.includes('subject') ? 'subject' : mine[0].where.includes('attachment') ? 'attachment' : 'quoted text'}`;
      if (!mine.some(strong)) out.blocked.push(`b: ${out.keyLabel} is only in the body (quoted / forwarded text)`);
      const rec = recOf(orderId, shipmentId);
      const conflicts = rec ? cueConflicts(cues, rec) : [];
      if (conflicts.length) {
        out.blocked.push(`c: the subject disagrees (${conflicts.join('; ')})`);
        out.check.push(...conflicts);
      }
      if (cues.multi) out.blocked.push('c: the subject names several products');
      if (orders.length === 1 && allOrders.length > 1) {
        const others = allOrders.filter((o) => o !== orderId).map((o) => records.find((r) => r.orderId === o)?.orderNo);
        out.blocked.push(`d: another order's key is in the email (#${others.join(', #')})`);
      }
      out.auto = out.blocked.length === 0 && allOrders.length === 1;
      return out;
    }
    return out;
  }
  out.blocked.push('a: no exact B/L / PI / CI of a record in the email');
  // Round P — the thread. 1. An accepted / auto-applied earlier message: the same link ("thread" — a person may
  // have confirmed it; auto only link-only, see the service). 2. A combined thread (several links): the reply
  // follows the one its subject describes, else "pick the shipment". 3. The earliest key in the thread.
  const combined = thread.candidates.length > 1 ? thread.candidates : thread.candidates.length === 1 && thread.accepted && (thread.candidates[0].orderId !== thread.accepted.orderId || (thread.candidates[0].shipmentId ?? null) !== (thread.accepted.shipmentId ?? null)) ? [thread.accepted, ...thread.candidates] : [];
  if (combined.length > 1) {
    const refs = combined.map((c) => refOf(c.orderId, c.shipmentId));
    const agree = combined
      .map((c) => ({ c, rec: recOf(c.orderId, c.shipmentId) }))
      .filter(({ rec }) => rec && !cueConflicts(cues, rec).length && cueScore(cues, rec).score > 0)
      .map(({ c, rec }) => ({ c, s: cueScore(cues, rec!) }))
      .sort((a, b) => b.s.score - a.s.score);
    if (!cues.multi && agree.length && (agree.length === 1 || agree[0].s.score > agree[1].s.score)) {
      out.target = agree[0].c;
      out.kind = 'thread';
      out.confidence = 'thread';
      out.threadFrom = 'followed';
      out.reason = `this thread covers ${refs.join(' / ')}; the subject describes ${refOf(agree[0].c.orderId, agree[0].c.shipmentId)} (${agree[0].s.reasons.join(', ')})`;
      out.blocked.push(`a: followed the thread's ${refOf(agree[0].c.orderId, agree[0].c.shipmentId)} by the subject — confirm`);
      return out;
    }
    out.multiOrderIds = [...new Set(combined.map((c) => c.orderId))];
    out.reason = `this thread covers ${refs.join(' / ')} — pick the shipment`;
    out.blocked.push(`a: pick the shipment (thread covers ${refs.join('/')})`);
    out.check.push(`pick the shipment — the thread covers ${refs.join(' / ')}`);
    return out;
  }
  if (thread.accepted) {
    out.target = thread.accepted;
    out.kind = 'thread';
    out.confidence = 'thread';
    out.threadFrom = 'accepted';
    out.reason = `an earlier email of this thread was linked to ${refOf(thread.accepted.orderId, thread.accepted.shipmentId)}`;
    const rec = recOf(thread.accepted.orderId, thread.accepted.shipmentId);
    const conflicts = rec ? cueConflicts(cues, rec) : [];
    if (conflicts.length) {
      out.blocked.push(`c: the subject disagrees (${conflicts.join('; ')})`);
      out.check.push(...conflicts);
    }
    // Link-only auto (the service also requires: nothing to file). A reply that files documents stays "Confirm match".
    out.auto = !conflicts.length && !cues.multi;
    return out;
  }
  if (thread.traced) {
    out.target = { orderId: thread.traced.orderId, shipmentId: thread.traced.shipmentId };
    out.kind = 'thread';
    out.confidence = 'thread';
    out.threadFrom = 'traced';
    out.keyLabel = thread.traced.keyLabel;
    out.reason = `${thread.traced.keyLabel} is in an earlier email of this thread${thread.traced.date ? ` (${thread.traced.date})` : ''}`;
    out.blocked.push(`b: ${thread.traced.keyLabel} is in an earlier email of the thread, not in this one — confirm`);
    const rec = recOf(thread.traced.orderId, thread.traced.shipmentId);
    const conflicts = rec ? cueConflicts(cues, rec) : [];
    if (conflicts.length) {
      out.blocked.push(`c: the subject disagrees (${conflicts.join('; ')})`);
      out.check.push(...conflicts);
    }
    return out;
  }
  const open = scored.filter((x) => x.open);
  const [best, second] = open;
  if (best && best.score >= 4 && best.score - (second?.score ?? -99) >= 2 && !cues.multi) {
    out.target = { orderId: best.r.orderId, shipmentId: best.r.shipmentId };
    out.kind = 'cues';
    out.confidence = 'cues';
    out.reason = `the subject describes ${recordRef(best.r)} (${best.reasons.join(', ')})`;
    out.check.push(`matched by the subject only (${best.reasons.join(', ')})`);
  } else if (cues.multi) {
    out.multiOrderIds = [...new Set(open.filter((x) => x.score > 0).slice(0, 3).map((x) => x.r.orderId))];
    out.reason = 'the subject names several products';
  } else out.reason = 'no record number in the email or its thread, and the subject fits no single order';
  return out;
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
