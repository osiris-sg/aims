/**
 * New job form, Quotation search (WCT group, 2026-11-23): fast server search over thousands of quotations.
 *
 * The old query read every quotation's config (a 4 KB JSON each) several times per request to filter and match
 * the Subject, so WCT (S)'s 11.5k quotations took 1.3 to 2.2 s. This keeps, per company, a small in-process
 * index of what the search needs (number, customer text, Subject, customer id, cancelled, dates), read once with
 * one pass over each config and then topped up with only the quotations changed since (updatedAt), so a search
 * is a scan of short strings. Only the matches shown (max 20) are then read from the database for the list.
 * A full re-read every 5 minutes drops anything the top-up cannot see (raw updates, deletes).
 */
export const QUOTATION_TYPES = ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'] as const;

export interface QuotationIndexEntry {
  id: string;
  /** Lower-case text searched: number, customer text (listSearch), Subject. */
  hay: string;
  customerId: string | null;
  cancelled: boolean;
  createdAt: number;
}

export interface QuotationIndexRow {
  id: string;
  name: string | null;
  listSearch: string | null;
  listCustomerId: string | null;
  subject: string | null;
  dsubject: string | null;
  cancelled: string | null;
  voided: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

const FRESH_MS = 3_000;
const FULL_MS = 5 * 60_000;

export function entryOf(r: QuotationIndexRow): QuotationIndexEntry {
  const hay = [r.name, r.listSearch, r.subject, r.dsubject]
    .filter((x) => typeof x === 'string' && x)
    .join('\u0001')
    .toLowerCase();
  return {
    id: r.id,
    hay,
    customerId: r.listCustomerId || null,
    cancelled: String(r.cancelled ?? '').toLowerCase() === 'true' || String(r.voided ?? '').toLowerCase() === 'true',
    createdAt: new Date(r.createdAt).getTime(),
  };
}

/**
 * The matching quotation ids, newest first. term: lower-case substring of number / customer / Subject (or a
 * customer whose name matched: customerIds). customerId: only that customer's. Cancelled ones never.
 */
export function matchIds(entries: QuotationIndexEntry[], opts: { term?: string | null; customerId?: string | null; customerIds?: Set<string> | null }): string[] {
  const term = (opts.term ?? '').trim().toLowerCase();
  const out: string[] = [];
  for (const e of entries) {
    if (e.cancelled) continue;
    if (opts.customerId && e.customerId !== opts.customerId) continue;
    if (term && !e.hay.includes(term) && !(e.customerId && opts.customerIds?.has(e.customerId))) continue;
    out.push(e.id);
  }
  return out;
}

type OrgIndex = { entries: Map<string, QuotationIndexEntry>; sorted: QuotationIndexEntry[]; syncedAt: number; fullAt: number; since: Date | null };

const SELECT = `
  SELECT d.id, d.name, d."listSearch", d."listCustomerId", d."createdAt", d."updatedAt",
         x.subject, x."documentInfo" ->> 'subject' AS dsubject, x.cancelled, x.voided
  FROM "Document" d
  CROSS JOIN LATERAL jsonb_to_record(CASE WHEN jsonb_typeof(d.config) = 'object' THEN d.config ELSE '{}'::jsonb END)
    AS x(subject text, "documentInfo" jsonb, cancelled text, voided text)
  WHERE d."organizationId" = $1 AND d.type IN ('QUOTATION', 'QO', 'QO1', 'QO2', 'QT')`;

export class QuotationSearchIndex {
  private orgs = new Map<string, OrgIndex>();
  private busy = new Map<string, Promise<OrgIndex>>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** The org's entries, newest first (loaded or topped up when needed). */
  async entries(prisma: any, organizationId: string): Promise<QuotationIndexEntry[]> {
    return (await this.ensure(prisma, organizationId)).sorted;
  }

  /** Forget an org (or all): the next search reads it again. */
  invalidate(organizationId?: string) {
    if (organizationId) this.orgs.delete(organizationId);
    else this.orgs.clear();
  }

  /** Start reading an org in the background (the jobs calendar loads: the New job search is warm by the time it opens). */
  warm(prisma: any, organizationId: string): void {
    if (this.orgs.has(organizationId) || this.busy.has(organizationId)) return;
    void this.ensure(prisma, organizationId).catch(() => undefined);
  }

  private async ensure(prisma: any, organizationId: string): Promise<OrgIndex> {
    const cur = this.orgs.get(organizationId);
    const t = this.now();
    if (!cur) return this.once(organizationId, () => this.load(prisma, organizationId, null, t));
    // The 5-minute full re-read runs in the background; searches keep using the index meanwhile.
    if (t - cur.fullAt >= FULL_MS && !this.fullBusy.has(organizationId)) {
      this.fullBusy.add(organizationId);
      void this.load(prisma, organizationId, null, t)
        .catch(() => undefined)
        .finally(() => this.fullBusy.delete(organizationId));
    }
    if (t - cur.syncedAt < FRESH_MS) return cur;
    return this.once(organizationId, () => this.load(prisma, organizationId, cur, t));
  }

  private fullBusy = new Set<string>();

  private async once(organizationId: string, run: () => Promise<OrgIndex>): Promise<OrgIndex> {
    const running = this.busy.get(organizationId);
    if (running) return running;
    const job = run();
    this.busy.set(organizationId, job);
    try {
      return await job;
    } finally {
      this.busy.delete(organizationId);
    }
  }

  /** A full read (base null) or a top-up of base with the quotations changed since its last read. */
  private async load(prisma: any, organizationId: string, base: OrgIndex | null, t: number): Promise<OrgIndex> {
    const rows: QuotationIndexRow[] = base
      ? await prisma.$queryRawUnsafe(`${SELECT} AND d."updatedAt" >= $2`, organizationId, base.since ?? new Date(0))
      : await prisma.$queryRawUnsafe(SELECT, organizationId);
    const latest = this.orgs.get(organizationId);
    const entries = base ? (latest ?? base).entries : new Map<string, QuotationIndexEntry>();
    let since = base ? (latest ?? base).since : null;
    for (const r of rows) {
      entries.set(r.id, entryOf(r));
      const u = new Date(r.updatedAt);
      if (!since || u > since) since = u;
    }
    const next: OrgIndex = {
      entries,
      sorted: [...entries.values()].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1)),
      syncedAt: t,
      fullAt: base ? (latest ?? base).fullAt : t,
      since,
    };
    this.orgs.set(organizationId, next);
    return next;
  }
}

/** Order statuses that close a quotation for the "open" list (same as the Orders page's Completed / Cancelled). */
export const CLOSED_ORDER_STATUSES = new Set(['PAID', 'CLOSED', 'COMPLETED', 'CANCELLED']);
export const isOpenQuotation = (orderStatus: string | null | undefined) => !orderStatus || !CLOSED_ORDER_STATUSES.has(String(orderStatus));

/** The process-wide index (deliveries.service search; the jobs calendar warms it). */
export const quotationIndex = new QuotationSearchIndex();
