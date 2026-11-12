import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { JournalService } from 'src/journal/journal.service';

/**
 * Role-based home (orgs with enableRoleHome): ONE snapshot of the org's own
 * figures for every card on the screen (guru 2026-11-12: "make sure all the
 * data is correct and not sample data"). The portal cuts it per role
 * (Business Owner / HR + Finance / Ops); nothing here is invented — a figure
 * the org has no data for comes back as 0 or null and the screen says so.
 *
 * Fast by construction: the big tables are aggregated in Postgres (one raw
 * query per table), never paged into Node — see scanDocs in the aged reports
 * for the slow pattern this avoids.
 *
 * Conventions:
 *  - AR/AP "outstanding" follows the aged reports (document-money stamps:
 *    outstandingBalance → xeroBalance → gross; voided docs skipped).
 *  - "Due" is the document's dueDate; a document without one (legacy
 *    imports) is treated as due 30 days after its date.
 *  - Revenue / expenditure / cash movements come from POSTED journals, the
 *    same account types the Finance Hub uses.
 *  - Dates are the CLIENT's local day (`today` + `tzOffset`), so "today" is
 *    the user's today, not the server's.
 */

export type RoleHomeSnapshot = ReturnType<RoleHomeService['snapshot']> extends Promise<infer T> ? T : never;

const NUM = '^-?[0-9]+([.][0-9]+)?$';
const ISO = '^[0-9]{4}-[0-9]{2}-[0-9]{2}';
const R2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

@Injectable()
export class RoleHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
  ) {}

  async snapshot(organizationId: string, opts: { days?: number; today?: string; tzOffset?: number }) {
    const days = [7, 30, 90].includes(Number(opts.days)) ? Number(opts.days) : 30;
    const todayIso = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.today || '')) ? String(opts.today) : new Date().toISOString().slice(0, 10);
    // Client offset in minutes (Date.getTimezoneOffset(): SG = -480).
    const tz = Number.isFinite(Number(opts.tzOffset)) ? Number(opts.tzOffset) : 0;
    const dayMs = 86_400_000;
    const todayStart = new Date(new Date(`${todayIso}T00:00:00Z`).getTime() + tz * 60_000);
    const todayEnd = new Date(todayStart.getTime() + dayMs - 1);
    const start = new Date(todayStart.getTime() - (days - 1) * dayMs);
    const prevStart = new Date(start.getTime() - days * dayMs);
    // Calendar days of the window, as local ISO dates, for bucketing.
    const dayKeys: string[] = [];
    const todayUtc = new Date(`${todayIso}T00:00:00Z`).getTime();
    for (let i = 0; i < days; i++) dayKeys.push(new Date(todayUtc - (days - 1 - i) * dayMs).toISOString().slice(0, 10));
    const idx = new Map(dayKeys.map((k, i) => [k, i]));
    const zeros = () => dayKeys.map(() => 0);

    const [ar, ap, flows, tb, settings, queue, draftJournals, quotations, doPending, lowStock, invoicesIssued, receipts, deliveries] = await Promise.all([
      this.docStats(organizationId, "'INVOICE','TI','TI2'", todayIso),
      this.docStats(organizationId, "'BILL'", todayIso),
      this.flows(organizationId, prevStart, todayEnd),
      this.journal.trialBalance(organizationId, todayEnd).catch(() => ({ rows: [] as any[] })),
      this.prisma.accountingSetting.findUnique({ where: { organizationId }, select: { baseCurrency: true } }).catch(() => null),
      // Same rule as the Posting Queue: every unconfirmed sales / supplier / receipt document.
      this.prisma.document.count({
        where: {
          organizationId,
          type: { in: ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'BILL', 'OFFICIAL_RECEIPT', 'PAYMENT_VOUCHER'] },
          OR: [{ config: { path: ['glPosting', 'status'], equals: 'pending' } }, { status: { in: ['draft', 'unconfirmed'] as any } }],
        },
      }),
      this.prisma.journalEntry.count({ where: { organizationId, status: 'DRAFT' } }),
      this.prisma.document.count({ where: { organizationId, type: { in: ['QUOTATION', 'QO', 'QT', 'QO1'] }, status: { in: ['draft', 'unconfirmed'] as any } } }),
      this.prisma.document.count({ where: { organizationId, type: { in: ['DO', 'DELIVERY_ORDER'] }, status: 'pending_delivery' as any } }),
      // Low stock = at or under the product's own minimum (only products that set one).
      this.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n FROM "Asset"
        WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL
          AND "minQuantity" IS NOT NULL AND quantity IS NOT NULL AND quantity <= "minQuantity"`.then((r) => Number(r?.[0]?.n) || 0).catch(() => 0),
      this.prisma.$queryRaw<Array<{ d: string; n: number }>>`
        SELECT LEFT(config->>'date', 10) AS d, COUNT(*)::int AS n
        FROM "Document"
        WHERE "organizationId" = ${organizationId} AND type IN ('INVOICE','TI','TI2')
          AND COALESCE(config->>'voided','false') <> 'true'
          AND config->>'date' ~ ${ISO}
          AND LEFT(config->>'date', 10) >= ${prevStart.toISOString().slice(0, 10)}
          AND LEFT(config->>'date', 10) <= ${todayIso}
        GROUP BY 1`.catch(() => [] as Array<{ d: string; n: number }>),
      this.prisma.$queryRaw<Array<{ d: string; amt: number }>>`
        SELECT ("paymentDate" + make_interval(mins => ${-tz}::int))::date::text AS d, SUM(amount)::float AS amt
        FROM "Payment"
        WHERE "organizationId" = ${organizationId} AND "paymentMethod" <> 'offset'
          AND "paymentDate" >= ${prevStart} AND "paymentDate" <= ${todayEnd}
        GROUP BY 1`.catch(() => [] as Array<{ d: string; amt: number }>),
      this.deliveries(organizationId, todayStart, todayEnd, start, prevStart),
    ]);

    // ── Period series + totals from the journal flows ─────────────────
    const series = { revenue: zeros(), expenditure: zeros(), cash: zeros() };
    const totals = { revenue: [0, 0], expenditure: [0, 0], cash: [0, 0] }; // [current, previous]
    const startKey = dayKeys[0];
    for (const f of flows) {
      const key = String(f.d).slice(0, 10);
      const cur = key >= startKey;
      const i = idx.get(key);
      const credit = Number(f.credit) || 0;
      const debit = Number(f.debit) || 0;
      const rev = f.k === 'rev' ? credit - debit : 0;
      const exp = f.k === 'exp' ? debit - credit : 0;
      const cash = f.k === 'cash' ? debit - credit : 0;
      const t = cur ? 0 : 1;
      totals.revenue[t] += rev;
      totals.expenditure[t] += exp;
      totals.cash[t] += cash;
      if (cur && i !== undefined) {
        series.revenue[i] += rev;
        series.expenditure[i] += exp;
        series.cash[i] += cash;
      }
    }
    // Cash: balance now (trial balance), walked back day by day for the line.
    const cashNow = R2((tb.rows || []).filter((r: any) => this.journal.isCashOrBankAccount(r)).reduce((s: number, r: any) => s + (Number(r.balance) || 0), 0));
    const cashLine = zeros();
    let running = cashNow;
    for (let i = dayKeys.length - 1; i >= 0; i--) {
      cashLine[i] = R2(running);
      running -= series.cash[i];
    }
    const cashAtStart = R2(running); // balance before the window opened

    const invSeries = zeros();
    let invCur = 0;
    let invPrev = 0;
    for (const r of invoicesIssued) {
      const key = String(r.d).slice(0, 10);
      const i = idx.get(key);
      if (i !== undefined) {
        invSeries[i] += Number(r.n) || 0;
        invCur += Number(r.n) || 0;
      } else if (key < startKey) invPrev += Number(r.n) || 0;
    }
    const recSeries = zeros();
    let recCur = 0;
    let recPrev = 0;
    for (const r of receipts) {
      const key = String(r.d).slice(0, 10);
      const i = idx.get(key);
      if (i !== undefined) {
        recSeries[i] += Number(r.amt) || 0;
        recCur += Number(r.amt) || 0;
      } else if (key < startKey) recPrev += Number(r.amt) || 0;
    }

    return {
      asOf: new Date().toISOString(),
      today: todayIso,
      days,
      currency: settings?.baseCurrency || 'SGD',
      receivables: ar,
      payables: ap,
      revenue: { current: R2(totals.revenue[0]), previous: R2(totals.revenue[1]), series: series.revenue.map(R2) },
      expenditure: { current: R2(totals.expenditure[0]), previous: R2(totals.expenditure[1]), series: series.expenditure.map(R2) },
      cash: { balance: cashNow, atStart: cashAtStart, series: cashLine },
      invoicesIssued: { current: invCur, previous: invPrev, series: invSeries },
      receipts: { current: R2(recCur), previous: R2(recPrev), series: recSeries.map(R2) },
      pending: { unconfirmedDocuments: queue, draftJournals, quotationsAwaiting: quotations, deliveryOrdersPending: doPending },
      stock: { low: lowStock },
      deliveries,
    };
  }

  /** AR or AP in one aggregate: open count, outstanding, overdue, due today. */
  private async docStats(organizationId: string, typesSql: string, todayIso: string) {
    // `typesSql` is a constant literal list from this file, never user input.
    let rows: any[] = [];
    try {
      rows = (await this.prisma.$queryRawUnsafe(
      `WITH d AS (
         SELECT
           CASE WHEN config->>'outstandingBalance' ~ $3 THEN (config->>'outstandingBalance')::numeric
                WHEN config->>'xeroBalance' ~ $3 THEN (config->>'xeroBalance')::numeric
                WHEN config->>'totalWithTax' ~ $3 THEN (config->>'totalWithTax')::numeric
                WHEN config->>'nettTotal' ~ $3 THEN (config->>'nettTotal')::numeric
                WHEN config->>'totalAmount' ~ $3 THEN (config->>'totalAmount')::numeric
                ELSE 0 END AS outstanding,
           COALESCE(
             CASE WHEN config->>'dueDate' ~ $4 THEN LEFT(config->>'dueDate', 10)::date END,
             CASE WHEN config->>'date' ~ $4 THEN LEFT(config->>'date', 10)::date + 30 END,
             "createdAt"::date + 30) AS due
         FROM "Document"
         WHERE "organizationId" = $1 AND type IN (${typesSql})
           AND COALESCE(config->>'voided','false') <> 'true'
       )
       SELECT COUNT(*) FILTER (WHERE outstanding > 0.005)::int AS open_count,
              COALESCE(SUM(outstanding) FILTER (WHERE outstanding > 0.005), 0)::float AS outstanding,
              COALESCE(SUM(outstanding) FILTER (WHERE outstanding > 0.005 AND due < $2::date), 0)::float AS overdue,
              COUNT(*) FILTER (WHERE outstanding > 0.005 AND due < $2::date)::int AS overdue_count,
              COALESCE(SUM(outstanding) FILTER (WHERE outstanding > 0.005 AND due = $2::date), 0)::float AS due_today,
              COUNT(*) FILTER (WHERE outstanding > 0.005 AND due = $2::date)::int AS due_today_count
       FROM d`,
      organizationId,
      todayIso,
      NUM,
      ISO,
      )) as any[];
    } catch {
      rows = [];
    }
    const r = rows?.[0] || {};
    return {
      openCount: Number(r.open_count) || 0,
      outstanding: R2(r.outstanding),
      overdue: R2(r.overdue),
      overdueCount: Number(r.overdue_count) || 0,
      dueToday: R2(r.due_today),
      dueTodayCount: Number(r.due_today_count) || 0,
    };
  }

  /** Daily posted movement on revenue / expense / cash accounts, in one query. */
  private async flows(organizationId: string, from: Date, to: Date): Promise<Array<{ d: string; k: string; debit: number; credit: number }>> {
    // The cash rule mirrors JournalService.isCashOrBankAccount (default
    // codes, FOREIGN_BANK, current assets named bank/cash).
    return this.prisma.$queryRaw<Array<{ d: string; k: string; debit: number; credit: number }>>`
      SELECT d, k, SUM(debit)::float AS debit, SUM(credit)::float AS credit FROM (
        SELECT je."entryDate"::date::text AS d,
               CASE WHEN c."accountType" IN ('SALES','INCOME') THEN 'rev'
                    WHEN c."accountType" IN ('EXPENSE','EXCHANGE_GAIN_LOSS','PURCHASE','TAX') THEN 'exp'
                    WHEN c.code IN ('CA004','CA600','CA006') OR c.code ~ '^CA1[0-9]{2}$' OR c."accountType" = 'FOREIGN_BANK'
                         OR (c."accountType" = 'CURRENT_ASSET' AND lower(c.name) ~ '(^|[^a-z])(bank|cash)([^a-z]|$)') THEN 'cash'
                    END AS k,
               l.debit, l.credit
        FROM "JournalEntryLine" l
        JOIN "JournalEntry" je ON je.id = l."journalEntryId"
        JOIN "ChartOfAccount" c ON c.id = l."accountId"
        WHERE je."organizationId" = ${organizationId} AND je.status = 'POSTED'
          AND je."entryDate" >= ${from} AND je."entryDate" <= ${to}
      ) x
      WHERE k IS NOT NULL
      GROUP BY 1, 2`.catch(() => []);
  }

  /** Delivery runs (orgs with the Deliveries module; null when the org has none). */
  private async deliveries(organizationId: string, todayStart: Date, todayEnd: Date, start: Date, prevStart: Date) {
    try {
      const in5 = new Date(todayEnd.getTime() + 5 * 86_400_000);
      const live = { organizationId, status: { notIn: ['cancelled'] as any } };
      const [total, today, upcoming, open, done, donePrev] = await Promise.all([
        this.prisma.delivery.count({ where: { organizationId } }),
        this.prisma.delivery.count({ where: { ...live, scheduledFor: { gte: todayStart, lte: todayEnd } } }),
        this.prisma.delivery.count({ where: { ...live, scheduledFor: { gt: todayEnd, lte: in5 } } }),
        this.prisma.delivery.count({ where: { organizationId, status: { in: ['scheduled', 'in_progress'] as any } } }),
        // No completion stamp on the run: the last update of a delivered /
        // completed run is when it closed.
        this.prisma.delivery.findMany({
          where: { organizationId, status: { in: ['delivered', 'completed'] as any }, updatedAt: { gte: start, lte: todayEnd } },
          select: { scheduledFor: true, updatedAt: true },
        }),
        this.prisma.delivery.count({ where: { organizationId, status: { in: ['delivered', 'completed'] as any }, updatedAt: { gte: prevStart, lt: start } } }),
      ]);
      if (!total) return null;
      const scheduled = done.filter((d) => d.scheduledFor);
      const onTime = scheduled.filter((d) => d.updatedAt.toISOString().slice(0, 10) <= (d.scheduledFor as Date).toISOString().slice(0, 10)).length;
      return {
        today,
        upcoming5d: upcoming,
        open,
        completed: done.length,
        completedPrevious: donePrev,
        onTimePct: scheduled.length ? Math.round((onTime / scheduled.length) * 100) : null,
      };
    } catch {
      return null;
    }
  }
}
