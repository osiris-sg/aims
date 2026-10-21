/**
 * Email threads (round P, 2026-10-21) — pure. One row per thread in the inbox
 * and on the Sales dashboard: messages are grouped by their Message-ID chain
 * (Message-ID ↔ In-Reply-To / References) and, when a message carries no such
 * header (the worker deployed before header support rebuilds the .eml without
 * them), by the normalised subject ("Re:" / "FW:" / "[tag]" stripped —
 * threadKeyOf). A thread's link is the order / shipment its messages are
 * linked to: an accepted or auto-applied message first, else the best
 * suggestion; several distinct links make a "combined" thread.
 *
 * Also here: why an unprocessed message still needs a person (the reason chip)
 * and the raw-.eml header parser used when the webhook payload has no thread
 * headers.
 */

export interface ThreadRow {
  id: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string[] | null;
  threadKey?: string | null;
  /** The email's own date, else when it was received. */
  date: Date | string | null;
  inboxState: string | null;
  orderId?: string | null;
  shipmentId?: string | null;
  /** actions.confidence: exact · thread · cues · manual · none. */
  confidence?: string | null;
  /** actions.review.outcome. */
  outcome?: string | null;
}

/** "<abc@x>" / " abc@x " → "abc@x" (never empty for a stored row: the store always has a Message-ID). */
export const normMessageId = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim().replace(/^<+|>+$/g, '').trim();
  return s ? s : null;
};

/** Message-ID, In-Reply-To and References from a raw RFC 822 head (folded lines joined; stops at the blank line). */
export function threadHeadersFromEml(raw: string): { messageId: string | null; inReplyTo: string | null; references: string[] } {
  const head = raw.split(/\r?\n\r?\n/)[0] ?? '';
  const lines = head.split(/\r?\n/);
  const h: Record<string, string> = {};
  let cur = '';
  for (const line of lines) {
    if (/^[ \t]/.test(line) && cur) {
      h[cur] += ' ' + line.trim();
      continue;
    }
    const i = line.indexOf(':');
    if (i <= 0) continue;
    cur = line.slice(0, i).trim().toLowerCase();
    h[cur] = (h[cur] ? h[cur] + ' ' : '') + line.slice(i + 1).trim();
  }
  const ids = (v: string | undefined) => (v ?? '').match(/<[^<>\s]+>/g)?.map((x) => normMessageId(x)!).filter(Boolean) ?? [];
  return { messageId: ids(h['message-id'])[0] ?? null, inReplyTo: ids(h['in-reply-to'])[0] ?? null, references: ids(h['references']) };
}

export interface Thread<T extends ThreadRow> {
  /** Stable: the oldest message's row id. */
  id: string;
  /** How the messages were tied together: Message-ID headers, the subject, or both. */
  by: 'headers' | 'subject' | 'both';
  /** Newest first. */
  messages: T[];
  /** The newest message's date. */
  latest: Date | null;
}

const dateOf = (r: ThreadRow): Date | null => {
  if (!r.date) return null;
  const d = new Date(r.date);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Group rows into threads (union-find over Message-ID links and equal subject keys). Newest thread first. */
export function groupThreads<T extends ThreadRow>(rows: T[]): Array<Thread<T>> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x) ?? x;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
    parent.set(x, p);
    return p;
  };
  const byHeaders = new Set<string>();
  const bySubject = new Set<string>();
  const union = (a: string, b: string, how: 'headers' | 'subject') => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
    (how === 'headers' ? byHeaders : bySubject).add(a).add(b);
  };
  for (const r of rows) parent.set(r.id, r.id);
  // Message-ID chain: a row referring to another row's Message-ID joins it.
  const byMid = new Map<string, T>();
  for (const r of rows) {
    const m = normMessageId(r.messageId);
    if (m && !byMid.has(m)) byMid.set(m, r);
  }
  for (const r of rows) {
    const refs = [r.inReplyTo, ...(r.references ?? [])].map(normMessageId).filter((x): x is string => !!x);
    for (const ref of refs) {
      const other = byMid.get(ref);
      if (other && other.id !== r.id) union(r.id, other.id, 'headers');
    }
  }
  // Subject fallback: the same normalised subject.
  const byKey = new Map<string, T>();
  for (const r of rows) {
    const k = (r.threadKey ?? '').trim();
    if (!k) continue;
    const first = byKey.get(k);
    if (!first) byKey.set(k, r);
    else union(r.id, first.id, 'subject');
  }
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const root = find(r.id);
    groups.set(root, [...(groups.get(root) ?? []), r]);
  }
  const time = (r: ThreadRow) => dateOf(r)?.getTime() ?? 0;
  const out: Array<Thread<T>> = [];
  for (const members of groups.values()) {
    const messages = [...members].sort((a, b) => time(b) - time(a));
    const oldest = [...members].sort((a, b) => time(a) - time(b))[0];
    const h = members.some((m) => byHeaders.has(m.id));
    const s = members.some((m) => bySubject.has(m.id));
    out.push({ id: oldest.id, by: h && s ? 'both' : h ? 'headers' : 'subject', messages, latest: dateOf(messages[0]) });
  }
  return out.sort((a, b) => (b.latest?.getTime() ?? 0) - (a.latest?.getTime() ?? 0));
}

export type ReasonCode = 'CONFIRM' | 'PICK_ORDER' | 'PICK_SHIPMENT' | 'CHECK' | 'IS_SHIPMENT';

/**
 * Why an unprocessed message still needs a person — the reason chip.
 *   CHECK          the subject disagrees with the match (or a quoted key was ignored)
 *   PICK_SHIPMENT  the thread / email covers several orders or shipments — pick one
 *   PICK_ORDER     nothing matched
 *   CONFIRM        matched; waiting for Confirm
 *   IS_SHIPMENT    the AI couldn't tell whether it is shipment mail at all (Unsure)
 */
export function unprocessedReason(m: {
  inboxState: string | null;
  orderId?: string | null;
  shipmentId?: string | null;
  check?: string[] | null;
  multiOrderRefs?: string[] | null;
  needsShipment?: boolean;
}): { code: ReasonCode; label: string } | null {
  if (m.inboxState === 'PROCESSED' || m.inboxState === 'PURGED' || m.inboxState === 'UNDONE') return null;
  const multi = (m.multiOrderRefs ?? []).filter(Boolean);
  if (m.inboxState === 'UNSURE' && !m.orderId) return { code: 'IS_SHIPMENT', label: 'Is it a shipment?' };
  if (m.check?.length) return { code: 'CHECK', label: 'Check — subject disagrees' };
  if (multi.length > 1 || m.needsShipment) return { code: 'PICK_SHIPMENT', label: multi.length > 1 ? `Pick shipment (thread covers ${multi.slice(0, 3).join('/')})` : 'Pick shipment' };
  if (!m.orderId && !m.shipmentId) return { code: 'PICK_ORDER', label: 'Pick order' };
  return { code: 'CONFIRM', label: 'Confirm match' };
}

const RANK: Record<string, number> = { manual: 0, exact: 1, thread: 2, cues: 3, none: 9 };

/**
 * The thread's link: what its messages are linked to. Accepted / auto-applied messages first (an ignored one
 * doesn't count), then suggestions by confidence. Several distinct links → `combined` (each listed).
 */
export function threadLink<T extends ThreadRow>(messages: T[]): { orderId: string; shipmentId: string | null; from: 'processed' | 'suggested'; combined: Array<{ orderId: string; shipmentId: string | null }> } | null {
  const linked = messages.filter((m) => m.orderId || m.shipmentId);
  if (!linked.length) return null;
  const processed = linked.filter((m) => m.inboxState === 'PROCESSED' && m.outcome !== 'IGNORED');
  const pool = processed.length ? processed : linked;
  const best = [...pool].sort((a, b) => (RANK[a.confidence ?? 'none'] ?? 9) - (RANK[b.confidence ?? 'none'] ?? 9))[0];
  const seen = new Map<string, { orderId: string; shipmentId: string | null }>();
  for (const m of pool) {
    const k = `${m.orderId}:${m.shipmentId ?? ''}`;
    if (!seen.has(k)) seen.set(k, { orderId: m.orderId!, shipmentId: m.shipmentId ?? null });
  }
  return { orderId: best.orderId!, shipmentId: best.shipmentId ?? null, from: processed.length ? 'processed' : 'suggested', combined: seen.size > 1 ? [...seen.values()] : [] };
}
