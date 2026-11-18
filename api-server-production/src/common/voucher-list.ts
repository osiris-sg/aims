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

  // Compare the DAY only: a voucher whose date was stored as an ISO instant
  // ('2026-05-31T00:00:00.000Z') is longer than '2026-05-31' and a raw string
  // compare would drop it from a range ending that day.
  if (q.from) {
    params.push(String(q.from).slice(0, 10));
    where.push(`LEFT(COALESCE(d.config->>'date', ''), 10) >= $${params.length}`);
  }
  if (q.to) {
    params.push(String(q.to).slice(0, 10));
    where.push(`LEFT(COALESCE(d.config->>'date', ''), 10) <= $${params.length}`);
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

/**
 * JOURNAL VOUCHERS are a special case (guru 2026-11-18: "i added the jv list
 * for biofuel how come she cant see her jv like how chong aik can see").
 *
 * Chong Aik keys her journal vouchers on the J/V screen, so each one is a
 * JOURNAL_VOUCHER Document and the list above finds it. Biofuel's 1,842
 * journal vouchers came from Xero: they are MANUAL JournalEntry rows with no
 * document behind them, so a list that reads Documents only showed her an
 * empty table while her J/Vs sat in the ledger.
 *
 * So the list is the UNION of the two: the vouchers typed here, plus every
 * hand-keyed journal that has no voucher document (`type = 'MANUAL'`,
 * `sourceDocumentId IS NULL` — a journal born from an invoice or a receipt
 * belongs to that document, never here). Imported rows are read-only: they
 * open the journal view, not the editor, because re-saving a Xero-imported
 * journal would post it a second time.
 */
export type JvListRow = {
  id: string;
  source: 'document' | 'journal';
  voucherNumber: string;
  date: string | null;
  status: string;
  preparedBy: string;
  description: string;
  totalDebit: number;
  totalCredit: number;
};

// One row of the union, as SQL. `src` tells the two apart; `hay` is what the
// search box looks through.
const JV_UNION = `
  SELECT d.id::text AS id, 'document' AS src,
         COALESCE(d.name, '') AS number,
         LEFT(COALESCE(d.config->>'date', ''), 10) AS dt,
         COALESCE(d.status::text, '') AS status,
         COALESCE((d.config->>'totalDebit')::numeric, 0) AS amount,
         d."createdAt" AS created,
         CONCAT_WS(' ', d.name, d.config->>'preparedBy', d.config->>'remarks', d.config->>'description', d.config->>'notes', d.config->>'journalNumber') AS hay
    FROM "Document" d
   WHERE d."organizationId" = $1 AND d.type::text = 'JOURNAL_VOUCHER'
  UNION ALL
  SELECT j.id::text, 'journal',
         COALESCE(j."journalNumber", ''),
         to_char(j."entryDate", 'YYYY-MM-DD'),
         CASE WHEN j.status = 'VOID' THEN 'cancelled'
              WHEN j.status = 'DRAFT' OR j."isUnconfirmed" THEN 'unconfirmed'
              ELSE 'confirmed' END,
         COALESCE(j."totalDebit", 0)::numeric,
         j."createdAt",
         CONCAT_WS(' ', j."journalNumber", j.description, j.reference, j."createdBy") AS hay
    FROM "JournalEntry" j
   WHERE j."organizationId" = $1 AND j.type = 'MANUAL' AND j."sourceDocumentId" IS NULL
`;

// `createdBy` on an imported journal is a machine name — 'xero-import',
// 'legacy-import'. Under a column headed "Prepared by" that reads like a
// person, so say plainly where the voucher came from.
const importerLabel = (by?: string | null): string => {
  const v = String(by || '').trim();
  if (!v) return '';
  if (/^xero-/i.test(v)) return 'Xero import';
  if (/import/i.test(v)) return 'Imported';
  if (/^(system|script:)/i.test(v)) return 'System';
  return v;
};

type JvDb = Db & {
  journalEntry: { findMany: (args: any) => Promise<any[]> };
};

export async function listJournalVouchersPaged(
  prisma: JvDb,
  organizationId: string,
  q: VoucherListQuery,
  shapeDoc: (doc: any) => any,
): Promise<VoucherListResult<JvListRow>> {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));

  const params: any[] = [organizationId];
  const where: string[] = [];
  const term = (q.search || '').trim();
  if (term) {
    params.push(`%${term}%`);
    where.push(`v.hay ILIKE $${params.length}`);
  }
  const UNC = `v.status IN ('', 'draft', 'unconfirmed')`;
  const VOID_ = `v.status IN ('cancelled', 'void', 'voided')`;
  const status = (q.status || '').trim();
  if (status === 'Unconfirmed') where.push(UNC);
  else if (status === 'Void') where.push(VOID_);
  else if (status === 'Confirmed') where.push(`NOT (${UNC}) AND NOT (${VOID_})`);
  if (q.from) {
    params.push(String(q.from).slice(0, 10));
    where.push(`v.dt >= $${params.length}`);
  }
  if (q.to) {
    params.push(String(q.to).slice(0, 10));
    where.push(`v.dt <= $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const month = new Date().toISOString().slice(0, 7);
  params.push(MONTH_RE.test(month) ? month : '0000-00');
  const monthIdx = params.length;
  const [agg] = await prisma.$queryRawUnsafe<Array<{ total: bigint; this_month: bigint; unconfirmed: bigint; amount: string | null }>>(
    `WITH v AS (${JV_UNION})
     SELECT COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE LEFT(v.dt, 7) = $${monthIdx})::bigint AS this_month,
            COUNT(*) FILTER (WHERE ${UNC})::bigint AS unconfirmed,
            COALESCE(SUM(v.amount) FILTER (WHERE NOT (${VOID_})), 0)::text AS amount
       FROM v ${whereSql}`,
    ...params,
  );
  params.pop();

  const ids = await prisma.$queryRawUnsafe<Array<{ id: string; src: string }>>(
    `WITH v AS (${JV_UNION})
     SELECT v.id, v.src FROM v ${whereSql}
      ORDER BY v.dt DESC NULLS LAST, v.created DESC, v.id DESC
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    ...params,
  );

  const docIds = ids.filter((r) => r.src === 'document').map((r) => r.id);
  const jeIds = ids.filter((r) => r.src === 'journal').map((r) => r.id);
  // The org is re-asserted on both fetches, as above.
  const [docs, jes] = await Promise.all([
    docIds.length ? prisma.document.findMany({ where: { organizationId, id: { in: docIds } } }) : Promise.resolve([]),
    jeIds.length
      ? prisma.journalEntry.findMany({
          where: { organizationId, id: { in: jeIds } },
          select: {
            id: true, journalNumber: true, entryDate: true, status: true, isUnconfirmed: true,
            description: true, reference: true, createdBy: true, totalDebit: true, totalCredit: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const byId = new Map<string, JvListRow>();
  for (const d of docs) {
    const v: any = shapeDoc(d);
    byId.set(d.id, {
      id: v.id,
      source: 'document',
      voucherNumber: v.voucherNumber || '',
      date: v.date || null,
      status: String(v.status ?? ''),
      preparedBy: v.preparedBy || '',
      description: v.notes || '',
      totalDebit: Number(v.totalDebit) || 0,
      totalCredit: Number(v.totalCredit) || 0,
    });
  }
  for (const j of jes) {
    byId.set(j.id, {
      id: j.id,
      source: 'journal',
      voucherNumber: j.journalNumber || '',
      date: j.entryDate ? new Date(j.entryDate).toISOString().slice(0, 10) : null,
      status: j.status === 'VOID' ? 'cancelled' : j.status === 'DRAFT' || j.isUnconfirmed ? 'unconfirmed' : 'confirmed',
      // A journal that never passed through the J/V screen has no preparer;
      // say where it came from instead of inventing a name.
      preparedBy: importerLabel(j.createdBy),
      description: j.description || j.reference || '',
      totalDebit: Number(j.totalDebit) || 0,
      totalCredit: Number(j.totalCredit) || 0,
    });
  }

  return {
    rows: ids.map((r) => byId.get(r.id)).filter(Boolean) as JvListRow[],
    total: Number(agg?.total ?? 0),
    stats: {
      total: Number(agg?.total ?? 0),
      thisMonth: Number(agg?.this_month ?? 0),
      unconfirmed: Number(agg?.unconfirmed ?? 0),
      amount: Math.round(Number(agg?.amount ?? 0) * 100) / 100,
    },
  };
}
