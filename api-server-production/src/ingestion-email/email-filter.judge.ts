/**
 * Judge already-stored intake rows with the sender filter (round M) — the same rule as live intake, used by the
 * shadow backtest (scripts/email-filter-backtest.ts) and the SHADOW backfill (scripts/setup-adh-org.ts) so the
 * Filter preview shows mail that arrived before SHADOW went on. Rows oldest first: an earlier row of the thread
 * that is matched to an order, or that the allow-list kept, keeps its later replies. Purged / filtered rows have no
 * metadata — skipped (never judged). Pure.
 */
import { allowListHit, filterDecision, FilterConfig } from './email-filter.rules';
import { threadKeyOf } from './email-triage.rules';

export interface JudgeRow {
  id: string;
  messageId: string;
  fromAddress: string;
  subject: string | null;
  inboxState: string | null;
  rawMeta: unknown;
  threadKey: string | null;
  inReplyTo: string | null;
  orderId: string | null;
}
/** skipped: purged / filtered row without metadata (keep / reason then meaningless). */
export type Judged = { id: string; skipped: boolean; keep: boolean; reason: string };

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v ? [v] : []);

export function judgeStoredRows(rows: JudgeRow[], cfg: FilterConfig, ownDomains: string[], orderNoById: Map<string, number>): Judged[] {
  const seen: Array<{ messageId: string; threadKey: string | null; orderId: string | null; allowedBy: string | null }> = [];
  const out: Judged[] = [];
  for (const r of rows) {
    const meta = (r.rawMeta ?? {}) as Record<string, any>;
    if (r.inboxState === 'PURGED' || meta.filtered) {
      seen.push({ messageId: r.messageId, threadKey: r.threadKey, orderId: r.orderId, allowedBy: null });
      out.push({ id: r.id, skipped: true, keep: false, reason: '' });
      continue;
    }
    const refs = [r.inReplyTo, meta.inReplyTo, ...list(meta.references)].filter(Boolean).map(String);
    const key = r.threadKey ?? threadKeyOf(r.subject ?? null);
    const onThread = (p: (typeof seen)[number]) => refs.includes(p.messageId) || (!!key && p.threadKey === key);
    const prior = [...seen].reverse().find((p) => p.orderId && onThread(p));
    const threadOrder = prior?.orderId ? `#${orderNoById.get(prior.orderId) ?? '?'}` : null;
    const threadAllowed = [...seen].reverse().find((p) => p.allowedBy && onThread(p))?.allowedBy ?? null;
    const people = { from: r.fromAddress, to: list(meta.headerTo) as string[], cc: list(meta.cc) as string[] };
    const d = filterDecision({ ...people, subject: r.subject, attachmentNames: list(meta.attachmentNames).map(String), threadOrder, threadAllowed }, cfg, ownDomains);
    out.push({ id: r.id, skipped: false, keep: d.keep, reason: d.reason });
    seen.push({ messageId: r.messageId, threadKey: key, orderId: r.orderId, allowedBy: allowListHit(people, cfg, ownDomains) });
  }
  return out;
}
