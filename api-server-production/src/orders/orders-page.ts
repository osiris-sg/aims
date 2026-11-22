/**
 * WCT Orders list, paged on the server (2026-11-23; enableWctOrders). GET /orders/page answers one page (50) of the
 * list with its filters, search, sort and counts done here, so the page no longer loads all 6,669 rows. Ported from
 * the portal's list helpers so the tabs, counts and matches stay exactly as they were:
 *  - AIMS orders: the hub statuses (portal helpers/wctOrderHub.ts) or, with enableWctStatusFlow, Pending / Completed /
 *    Cancelled (helpers/wctStatusFlow.ts flowOrderStatus);
 *  - imported orders: their own statuses (helpers/importedOrders.ts IMPORTED_STATUS_TABS), keys "imported:STATUS";
 *  - search: order no., customer name / code, quotation no., subject, site (helpers/wctOrders.ts orderMatchesSearch).
 * AIMS rows are few and fully built (with their status sync, as before); imported rows are filtered, counted and
 * sorted in SQL and only the page's rows are built. The two sorted lists are merged two-pointer style, so page k of
 * the merge only needs the first (k+1) * 50 imported ids: Load more never repeats or skips a row.
 */

export type OrderSource = 'aims' | 'imported' | 'all';
export type SortKey = 'createdAt' | 'orderNumber' | 'customer' | 'amount' | 'billedPct' | 'status';
export const SORT_KEYS: SortKey[] = ['createdAt', 'orderNumber', 'customer', 'amount', 'billedPct', 'status'];
export const PAGE_SIZE = 50;

// ── Hub statuses (portal helpers/wctOrderHub.ts) ────────────────────────────
export const HUB_STATUSES: Array<{ key: string; label: string }> = [
  { key: 'QUOTATION_SIGNED', label: 'Quotation signed' },
  { key: 'DO_DRAFT', label: 'DO draft' },
  { key: 'DO_SCHEDULED', label: 'DO scheduled' },
  { key: 'AWAITING_VERIFICATION', label: 'Awaiting customer signature' },
  { key: 'INVOICE_DRAFT_DO_PENDING', label: 'Invoice draft, DO pending' },
  { key: 'INVOICED_DO_PENDING', label: 'Invoiced, DO pending' },
  { key: 'DO_COMPLETED', label: 'DO completed, invoice pending' },
  { key: 'INVOICE_DRAFT', label: 'Invoice draft' },
  { key: 'READY_FOR_SERVICE_REPORT', label: 'Ready for service report' },
  { key: 'INVOICED', label: 'Invoiced' },
  { key: 'PAID', label: 'Paid' },
  { key: 'SERVICE_REPORT_SENT', label: 'Service report sent' },
  { key: 'MARKED_COMPLETE', label: 'Complete' },
  { key: 'CANCELLED', label: 'Cancelled' },
];
const LEGACY: Record<string, string> = { OPEN: 'DO_DRAFT', SCHEDULED: 'DO_SCHEDULED', IN_PROGRESS: 'DO_SCHEDULED', COMPLETED: 'DO_COMPLETED', CLOSED: 'SERVICE_REPORT_SENT' };
const ALWAYS = new Set(['DO_DRAFT', 'DO_SCHEDULED', 'INVOICED_DO_PENDING', 'DO_COMPLETED', 'INVOICE_DRAFT', 'READY_FOR_SERVICE_REPORT', 'PAID', 'SERVICE_REPORT_SENT']);

export function hubStatus(status: unknown): string {
  const s = String(status || '');
  if (LEGACY[s]) return LEGACY[s];
  return HUB_STATUSES.find((x) => x.key === s)?.key ?? 'QUOTATION_SIGNED';
}
export const hubIndex = (status: unknown): number => HUB_STATUSES.findIndex((x) => x.key === hubStatus(status));

/** The SQL twin of hubIndex for a status column (imported rows' status sort). */
export function hubIndexSql(col: string): string {
  const cases = HUB_STATUSES.map((s, i) => `WHEN '${s.key}' THEN ${i}`).join(' ');
  const legacy = Object.entries(LEGACY)
    .map(([k, v]) => `WHEN '${k}' THEN ${HUB_STATUSES.findIndex((x) => x.key === v)}`)
    .join(' ');
  return `(CASE ${col} ${legacy} ${cases} ELSE 0 END)`;
}

// ── Status flow wording (portal helpers/wctStatusFlow.ts flowOrderStatus) ───
export function flowKey(o: { status?: string | null; completed?: unknown; invoices?: Array<{ status?: string | null }> | null }): 'pending' | 'completed' | 'cancelled' {
  const s = String(o?.status || '');
  if (s === 'CANCELLED') return 'cancelled';
  if (s === 'PAID' || s === 'CLOSED' || s === 'COMPLETED' || !!o?.completed) return 'completed';
  const live = (o?.invoices ?? []).filter((i) => !['voided', 'cancelled'].includes(String(i?.status || '')));
  if (s === 'SERVICE_REPORT_SENT' && live.length > 0 && live.every((i) => i.status === 'paid')) return 'completed';
  return 'pending';
}

// ── Imported statuses (portal helpers/importedOrders.ts) ────────────────────
export const IMPORTED_STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: 'PART_BILLED', label: 'Part billed' },
  { key: 'INVOICED', label: 'Invoiced' },
  { key: 'PAID', label: 'Paid' },
  { key: 'COMPLETED', label: 'Complete' },
  { key: 'DO_DRAFT', label: 'DO draft' },
  { key: 'DO_COMPLETED', label: 'DO completed, invoice pending' },
];
export const IMP = 'imported:';
export const isImportedTab = (tab: string) => tab.startsWith(IMP);

export interface Tab {
  key: string;
  label: string;
  count: number;
}

/**
 * The status filter's entries, exactly as the list built them: "All" (the rows of the source), then the AIMS
 * statuses (hub or flow wording), then the imported statuses that have rows. Counts ignore the search, as before.
 */
export function orderTabs(native: any[], importedCounts: Record<string, number>, opts: { flow: boolean; source: OrderSource }): Tab[] {
  const importedTotal = Object.values(importedCounts).reduce((t, n) => t + n, 0);
  const all = native.length + importedTotal;
  const imported = IMPORTED_STATUS_TABS.filter((t) => (importedCounts[t.key] ?? 0) > 0).map((t) => ({ key: IMP + t.key, label: `${t.label} (imported)`, count: importedCounts[t.key] }));
  if (opts.flow && (native.length || opts.source !== 'imported')) {
    const n = (k: string) => native.filter((o) => flowKey(o) === k).length;
    return [
      { key: 'all', label: 'All', count: all },
      { key: 'flow:pending', label: 'Pending', count: n('pending') },
      { key: 'flow:completed', label: 'Completed', count: n('completed') },
      ...(n('cancelled') ? [{ key: 'flow:cancelled', label: 'Cancelled', count: n('cancelled') }] : []),
      ...imported,
    ];
  }
  if (!native.length && opts.source === 'imported') return [{ key: 'all', label: 'All', count: all }, ...imported];
  const counts = new Map<string, number>();
  for (const o of native) counts.set(hubStatus(o.status), (counts.get(hubStatus(o.status)) ?? 0) + 1);
  return [
    { key: 'all', label: 'All', count: all },
    ...HUB_STATUSES.filter((s) => ALWAYS.has(s.key) || (counts.get(s.key) ?? 0) > 0).map((s) => ({ key: s.key, label: s.label, count: counts.get(s.key) ?? 0 })),
    ...imported,
  ];
}

/** An AIMS row against the status filter (never an imported entry). */
export function nativeMatchesTab(o: any, tab: string): boolean {
  if (tab === 'all' || !tab) return true;
  if (isImportedTab(tab)) return false;
  if (tab.startsWith('flow:')) return `flow:${flowKey(o)}` === tab;
  return hubStatus(o.status) === tab;
}

/** The search over order no., customer name / code, quotation no., subject and site. */
export function nativeMatchesSearch(o: any, q: string): boolean {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return true;
  return [o.orderNumber, o.customer?.name, o.customer?.customerCode, o.sourceQuotation?.name, o.subject, o.site].filter(Boolean).join('\u0001').toLowerCase().includes(t);
}

/** The imported status a tab names (null = any; undefined = the tab excludes imported rows). */
export function importedStatusOfTab(tab: string): string | null | undefined {
  if (!tab || tab === 'all') return null;
  return isImportedTab(tab) ? tab.slice(IMP.length) : undefined;
}

// ── Sort ────────────────────────────────────────────────────────────────────
export function parseSort(sort: unknown, dir: unknown): { key: SortKey; desc: boolean } {
  const key = SORT_KEYS.includes(sort as SortKey) ? (sort as SortKey) : 'createdAt';
  const desc = key === 'createdAt' && dir !== 'asc' ? true : dir === 'desc';
  return { key, desc };
}

/** A row's sort value (AIMS rows here; imported rows get the same value from SQL). Numbers or lower-case strings. */
export function sortValue(o: any, key: SortKey): number | string {
  switch (key) {
    case 'createdAt':
      return o.createdAt ? new Date(o.createdAt).getTime() || 0 : 0;
    case 'orderNumber':
      return String(o.orderNumber ?? '').toLowerCase();
    case 'customer':
      return String(o.customer?.name ?? '').toLowerCase();
    case 'amount':
      return Number.isFinite(Number(o.amount)) && o.amount !== null ? Number(o.amount) : -1;
    case 'billedPct':
      return o.imported && o.billedPct != null && Number.isFinite(Number(o.billedPct)) ? Number(o.billedPct) : -1;
    case 'status':
      return hubIndex(o.status);
  }
}

/** -1 / 0 / 1 for two sort values, then the id so the order is total. */
export function compareRows(a: { v: number | string; id: string }, b: { v: number | string; id: string }, desc: boolean): number {
  const c = a.v === b.v ? 0 : a.v < b.v ? -1 : 1;
  if (c) return desc ? -c : c;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Two-pointer merge of the AIMS rows (all, sorted) and the first imported ids (sorted by SQL), then the page. Only
 * the first offset + limit imported ids are ever needed.
 */
export function mergePage<N extends { id: string }>(
  native: Array<{ row: N; v: number | string }>,
  imported: Array<{ id: string; v: number | string }>,
  desc: boolean,
  offset: number,
  limit: number,
): Array<{ kind: 'native'; row: N } | { kind: 'imported'; id: string }> {
  const out: Array<{ kind: 'native'; row: N } | { kind: 'imported'; id: string }> = [];
  let i = 0;
  let j = 0;
  while (out.length < offset + limit && (i < native.length || j < imported.length)) {
    const takeNative = j >= imported.length || (i < native.length && compareRows({ v: native[i].v, id: native[i].row.id }, { v: imported[j].v, id: imported[j].id }, desc) <= 0);
    if (takeNative) out.push({ kind: 'native', row: native[i++].row });
    else out.push({ kind: 'imported', id: imported[j++].id });
  }
  return out.slice(offset, offset + limit);
}

/** The SQL ORDER BY expression of an imported row's sort value (same meaning as sortValue). */
export function importedSortSql(key: SortKey): string {
  const num = (expr: string) => `(CASE WHEN (${expr}) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${expr})::numeric ELSE -1 END)`;
  switch (key) {
    case 'createdAt':
      return `(extract(epoch from o."createdAt") * 1000)`;
    case 'orderNumber':
      return `lower(o."orderNumber")`;
    case 'customer':
      return `lower(COALESCE(c.name, ''))`;
    case 'amount':
      return num(`o."linkedDocuments"->'imported'->>'total'`);
    case 'billedPct':
      return num(`o."linkedDocuments"->'imported'->>'billedPct'`);
    case 'status':
      return hubIndexSql('o.status');
  }
}
