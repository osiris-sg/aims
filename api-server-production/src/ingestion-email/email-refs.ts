/**
 * Round AV — stored email texts (the matcher's reasons, the reasoner's note, a summary) name orders as they were
 * numbered WHEN they were written ("#25 · the subject describes it"). Orders get renumbered (round AT, and the
 * order page's renumber), so those texts are shown with today's numbers:
 *  1. refs the same decision pairs with a record id (a candidate's stored "#25" + its orderId) → that record's
 *     ref today (exact);
 *  2. other refs, only when the text's write time is known (the reasoner's `at`, a summary's `summaryAt`) →
 *     the order that had that number at that moment, by the renumber history (Activity Log rows
 *     details.orderNo {from, to}).
 * A ref neither rule can place is left as written. Nothing stored is changed.
 */

export interface RenumberEvent {
  orderId: string;
  at: Date;
  from: number;
  to: number;
}

/** "#25" / "#25-1" → order no. and the shipment suffix. */
const TOKEN = /#(\d{1,6})(-\d{1,3})?(?![\d-])/g;

/**
 * Old order number → today's, as at `at`: for each order renumbered after `at`, walk its renumbers back from
 * today's number to the one it had then.
 */
export function numbersAsAt(at: Date, events: RenumberEvent[], currentNo: Map<string, number>): Map<number, number> {
  const out = new Map<number, number>();
  const later = events.filter((e) => e.at.getTime() > at.getTime()).sort((a, b) => b.at.getTime() - a.at.getTime());
  const orders = new Set(later.map((e) => e.orderId));
  for (const id of orders) {
    const now = currentNo.get(id);
    if (now === undefined) continue;
    let n = now;
    for (const e of later) if (e.orderId === id && e.to === n) n = e.from;
    if (n !== now) out.set(n, now);
  }
  return out;
}

export interface RefFreshener {
  (text: string | null | undefined, opts?: { local?: Map<string, string>; at?: Date | string | null }): string;
}

/** Rewrites #n / #n-m in one text: exact local pairs first, then the history as at the text's write time. */
export function refFreshener(events: RenumberEvent[], currentNo: Map<string, number>): RefFreshener {
  const cache = new Map<number, Map<number, number>>();
  const asAt = (d: Date) => {
    const k = d.getTime();
    if (!cache.has(k)) cache.set(k, numbersAsAt(d, events, currentNo));
    return cache.get(k)!;
  };
  return (text, opts = {}) => {
    if (!text) return text ?? '';
    const at = opts.at ? new Date(opts.at) : null;
    const hist = at && !Number.isNaN(at.getTime()) ? asAt(at) : null;
    return text.replace(TOKEN, (tok, no: string, seq: string | undefined) => {
      const local = opts.local?.get(tok);
      if (local) return local;
      const orderLocal = seq ? opts.local?.get(`#${no}`) : null;
      if (orderLocal) return `${orderLocal}${seq}`;
      const n = hist?.get(Number(no));
      return n !== undefined ? `#${n}${seq ?? ''}` : tok;
    });
  };
}

/** The decision's own stored-ref → live-ref pairs (only the ones that changed). */
export function localRefMap(pairs: Array<{ stored: string | null | undefined; live: string | null | undefined }>): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of pairs) if (p.stored && p.live && p.stored !== p.live && /^#\d/.test(p.stored)) m.set(p.stored, p.live);
  return m;
}

/** Renumber events from Activity Log rows (resource trade-orders, details.orderNo {from, to}). */
export function renumberEventsOf(rows: Array<{ resourceId: string | null; createdAt: Date; details: unknown }>): RenumberEvent[] {
  const out: RenumberEvent[] = [];
  for (const r of rows) {
    const o = (r.details as { orderNo?: { from?: unknown; to?: unknown } } | null)?.orderNo;
    if (!r.resourceId || !o || typeof o !== 'object') continue;
    const from = Number(o.from);
    const to = Number(o.to);
    if (Number.isInteger(from) && Number.isInteger(to) && from !== to) out.push({ orderId: r.resourceId, at: new Date(r.createdAt), from, to });
  }
  return out;
}
