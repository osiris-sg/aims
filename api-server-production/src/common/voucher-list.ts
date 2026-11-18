/**
 * ONE paged, SERVER-FILTERED list for the three voucher documents — Official
 * Receipt, Payment Voucher, Journal Voucher (guru 2026-11-18).
 *
 * They used to answer "the newest 500 by createdAt" and leave the searching,
 * the filtering, the stat cards and the paging to the browser. That held while
 * a voucher was something a person typed. Then 2,950 receipts and vouchers
 * were minted from Xero's payment history IN ONE RUN on 2026-11-16: those rows
 * ARE the newest 500 by createdAt, so the list showed nothing but ORX-/PVX-
 * rows ending at 30 Sep 2026, "THIS MONTH 0" with October and November
 * receipts sitting in the database, and a search box that could not find
 * UOBOR2610-016 because it had never been fetched.
 *
 * So the WHERE, the ORDER, the page and the totals all happen in SQL, and the
 * order is the voucher's OWN date (config.date), never the row's createdAt —
 * an imported voucher is written long after the money moved.
 */

export type VoucherListQuery = {
  search?: string;
  status?: string; // Unconfirmed | Confirmed | Void
  from?: string; // YYYY-MM-DD, against the voucher's own date
  to?: string;
  page?: number;
  limit?: number;
};

export type VoucherListResult<T> = {
  rows: T[];
  total: number; // rows matching the filters — what the pager counts
  stats: { total: number; thisMonth: number; unconfirmed: number; amount: number };
};

export type VoucherType = 'OFFICIAL_RECEIPT' | 'PAYMENT_VOUCHER' | 'JOURNAL_VOUCHER';

/** Where each kind keeps the money, as an expression over `config`. */
const AMOUNT_SQL: Record<VoucherType, string> = {
  OFFICIAL_RECEIPT: `COALESCE((d.config->>'receiptAmount')::numeric, 0)`,
  PAYMENT_VOUCHER: `COALESCE((d.config->>'total')::numeric, (d.config->>'voucherAmount')::numeric, 0)`,
  JOURNAL_VOUCHER: `COALESCE((d.config->>'totalDebit')::numeric, 0)`,
};

/** The free-text fields each kind searches, besides the voucher number. */
const SEARCH_KEYS: Record<VoucherType, string[]> = {
  OFFICIAL_RECEIPT: ['customerName', 'remarks', 'chequeNo', 'journalNumber'],
  PAYMENT_VOUCHER: ['payee', 'supplierName', 'remarks', 'chequeNo', 'journalNumber'],
  JOURNAL_VOUCHER: ['preparedBy', 'remarks', 'description', 'journalNumber'],
};

// status is an ENUM column — compare it as text or Postgres rejects '' outright.
const UNCONFIRMED = `COALESCE(d.status::text, '') IN ('', 'draft', 'unconfirmed')`;
const VOIDED = `COALESCE(d.status::text, '') IN ('cancelled', 'void', 'voided')`;
const MONTH_RE = /^\d{4}-\d{2}$/;

type Db = {
  $queryRawUnsafe: <T = unknown>(sql: string, ...values: any[]) => Promise<T>;
  document: { findMany: (args: any) => Promise<any[]> };
};

export async function listVouchersPaged<T>(
  prisma: Db,
  organizationId: string,
  type: VoucherType,
  q: VoucherListQuery,
  shape: (doc: any) => T,
): Promise<VoucherListResult<T>> {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const amount = AMOUNT_SQL[type];

  const params: any[] = [organizationId, type];
  const where: string[] = [`d."organizationId" = $1`, `d.type = $2`];

  const term = (q.search || '').trim();
  if (term) {
    params.push(`%${term}%`);
    const i = params.length;
    const keys = SEARCH_KEYS[type].map((k) => `COALESCE(d.config->>'${k}', '') ILIKE $${i}`);
    where.push(`(COALESCE(d.name, '') ILIKE $${i} OR ${keys.join(' OR ')})`);
  }
  const status = (q.status || '').trim();
  if (status === 'Unconfirmed') where.push(UNCONFIRMED);
  else if (status === 'Void') where.push(VOIDED);
  else if (status === 'Confirmed') where.push(`NOT (${UNCONFIRMED}) AND NOT (${VOIDED})`);

  if (q.from) {
    params.push(String(q.from).slice(0, 10));
    where.push(`d.config->>'date' >= $${params.length}`);
  }
  if (q.to) {
    params.push(String(q.to).slice(0, 10));
    where.push(`d.config->>'date' <= $${params.length}`);
  }

  const whereSql = where.join(' AND ');
  // The cards describe the FILTERED set and are counted in the same pass as
  // the page, not over whatever the browser happened to download.
  const month = new Date().toISOString().slice(0, 7);
  const monthParam = MONTH_RE.test(month) ? month : '0000-00';
  params.push(monthParam);
  const monthIdx = params.length;
  const [agg] = await prisma.$queryRawUnsafe<Array<{ total: bigint; this_month: bigint; unconfirmed: bigint; amount: string | null }>>(
    `SELECT COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE LEFT(COALESCE(d.config->>'date', ''), 7) = $${monthIdx})::bigint AS this_month,
            COUNT(*) FILTER (WHERE ${UNCONFIRMED})::bigint AS unconfirmed,
            COALESCE(SUM(${amount}) FILTER (WHERE NOT (${VOIDED})), 0)::text AS amount
       FROM "Document" d WHERE ${whereSql}`,
    ...params,
  );
  params.pop(); // the month only belongs to the aggregate

  const ids = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT d.id::text AS id FROM "Document" d
      WHERE ${whereSql}
      ORDER BY d.config->>'date' DESC NULLS LAST, d."createdAt" DESC, d.id DESC
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    ...params,
  );
  // Re-assert the org on the fetch: the ids come from an org-scoped query
  // above, and this keeps that true if the two are ever separated.
  const docs = ids.length
    ? await prisma.document.findMany({ where: { organizationId, id: { in: ids.map((r) => r.id) } } })
    : [];
  const order = new Map(ids.map((r, i) => [r.id, i]));
  docs.sort((a: any, b: any) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return {
    rows: docs.map(shape),
    total: Number(agg?.total ?? 0),
    stats: {
      total: Number(agg?.total ?? 0),
      thisMonth: Number(agg?.this_month ?? 0),
      unconfirmed: Number(agg?.unconfirmed ?? 0),
      amount: Math.round(Number(agg?.amount ?? 0) * 100) / 100,
    },
  };
}
