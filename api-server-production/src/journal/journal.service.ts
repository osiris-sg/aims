import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreateJournalEntryDto, JournalLineDto, UpdateJournalEntryDto } from './dto/journal-entry.dto';
import { AnomaliesService } from '../anomalies/anomalies.service';

const ROUND = (n: number) => Math.round(n * 100) / 100;

// First day of the fiscal year that contains `asOf`, given the fiscal-year-end
// (e.g. 30 June → returns 1 July). Used for the P&L → Retained Earnings rollover.
function fiscalYearStart(asOf: Date, fyEndMonth: number, fyEndDay: number): Date {
  const y = asOf.getFullYear();
  const fyEndThisYear = new Date(y, fyEndMonth - 1, fyEndDay, 23, 59, 59, 999);
  const lastFyEnd = asOf > fyEndThisYear ? fyEndThisYear : new Date(y - 1, fyEndMonth - 1, fyEndDay, 23, 59, 59, 999);
  const start = new Date(lastFyEnd);
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);
  return start;
}

@Injectable()
export class JournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly anomalies: AnomaliesService,
  ) {}

  // ---------- Numbering ----------

  // ----------------------------------------------------------------------
  // Cash/Bank detection — used by hubStats, cashFlow, and anywhere else
  // that needs to know if an account represents real money. Works for any
  // CoA layout (AIMS default, Xero-imported, custom) by layering:
  //   1) AIMS default code patterns (CA004/CA006/CA600/CA1xx)
  //   2) FOREIGN_BANK accountType
  //   3) CURRENT_ASSET + name contains "bank" / "cash"
  // Add controls.cashAccount / controls.bankAccount overrides if/when an org
  // needs explicit control over what counts as cash.
  // ----------------------------------------------------------------------
  isCashOrBankAccount(a: { code: string; name?: string | null; accountType?: string | null }): boolean {
    if (a.code === 'CA004' || a.code === 'CA600' || a.code === 'CA006' || /^CA1\d{2}$/.test(a.code)) return true;
    if (a.accountType === 'FOREIGN_BANK') return true;
    if (a.accountType === 'CURRENT_ASSET' && a.name) {
      const n = a.name.toLowerCase();
      return /\bbank\b/.test(n) || /\bcash\b/.test(n);
    }
    return false;
  }

  private async nextJournalNumber(organizationId: string, prefix = 'JV'): Promise<string> {
    // Find the highest CANONICAL number (JV-<digits>) at the DB level. A plain
    // "order by journalNumber desc" is wrong here: suffixed numbers like
    // JV-XERO-22533 / JV-INV-000001 / JV-PAY-000002 lex-sort ABOVE JV-000001,
    // and with tens of thousands of imported JV-XERO-* rows a top-N scan finds
    // NO purely-numeric tail → it keeps suggesting JV-000001 and every posting
    // after the first hits the unique constraint. The regex + MAX(CAST(...))
    // ignores all suffixed numbers and reads the true max in one query.
    const start = prefix.length + 2; // 1-indexed char after "JV-"
    const pattern = `^${prefix}-[0-9]+$`;
    const rows = await this.prisma.$queryRawUnsafe<Array<{ maxseq: number | null }>>(
      `SELECT MAX(CAST(SUBSTRING("journalNumber" FROM ${start}) AS BIGINT)) AS maxseq
         FROM "JournalEntry"
        WHERE "organizationId" = $1 AND "journalNumber" ~ $2`,
      organizationId,
      pattern,
    );
    const nextSeq = Number(rows?.[0]?.maxseq ?? 0) + 1;
    return `${prefix}-${String(nextSeq).padStart(6, '0')}`;
  }

  // ---------- Validation ----------

  private validateLines(lines: JournalLineDto[]): { totalDebit: number; totalCredit: number } {
    if (!lines || lines.length < 2) {
      throw new BadRequestException('A journal entry needs at least two lines');
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const [i, l] of lines.entries()) {
      const d = Number(l.debit) || 0;
      const c = Number(l.credit) || 0;
      if (d < 0 || c < 0) throw new BadRequestException(`Line ${i + 1}: debit and credit must be >= 0`);
      if (d > 0 && c > 0) throw new BadRequestException(`Line ${i + 1}: cannot have both debit and credit`);
      if (d === 0 && c === 0) throw new BadRequestException(`Line ${i + 1}: must have either a debit or a credit`);
      totalDebit += d;
      totalCredit += c;
    }

    totalDebit = ROUND(totalDebit);
    totalCredit = ROUND(totalCredit);

    if (totalDebit !== totalCredit) {
      throw new BadRequestException(
        `Journal does not balance: debit ${totalDebit} ≠ credit ${totalCredit}`,
      );
    }

    return { totalDebit, totalCredit };
  }

  private async assertAccountsBelongToOrg(organizationId: string, accountIds: string[]) {
    const unique = Array.from(new Set(accountIds));
    const found = await this.prisma.chartOfAccount.findMany({
      where: { id: { in: unique }, organizationId, isActive: true },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw new BadRequestException('One or more lines reference an unknown or inactive account');
    }
  }

  // ---------- Create ----------

  async create(
    organizationId: string,
    dto: CreateJournalEntryDto,
    userId?: string,
    options?: { autoPost?: boolean; bypassPeriodLock?: boolean },
  ) {
    const { totalDebit, totalCredit } = this.validateLines(dto.lines);
    await this.assertAccountsBelongToOrg(organizationId, dto.lines.map((l) => l.accountId));

    // Period-lock guard — refuse to create an entry dated inside a closed
    // period. The Close Wizard itself bypasses this when posting the year-end
    // rollover JE (bypassPeriodLock=true).
    if (!options?.bypassPeriodLock) {
      const settings = await this.prisma.accountingSetting.findUnique({
        where: { organizationId },
        select: { lockedThroughDate: true },
      });
      if (settings?.lockedThroughDate) {
        const entryDate = new Date(dto.entryDate);
        if (entryDate <= settings.lockedThroughDate) {
          throw new BadRequestException(
            `Period is closed through ${settings.lockedThroughDate.toISOString().slice(0, 10)}. Cannot create entries dated on or before that date.`,
          );
        }
      }
    }

    // Retry on unique-constraint collisions: concurrent calls to nextJournalNumber
    // can both observe the same "highest" entry and pick the same number, or a
    // stray suffixed entry can shadow the canonical sequence. Cap at 5 retries.
    let lastError: any;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const journalNumber = dto.journalNumber || (await this.nextJournalNumber(organizationId));
      try {
        return await this.prisma.$transaction(async (tx) => {
          const entry = await tx.journalEntry.create({
            data: {
              organizationId,
              journalNumber,
              entryDate: new Date(dto.entryDate),
              type: dto.type,
              reference: dto.reference,
              description: dto.description,
              currency: dto.currency || 'SGD',
              sourceDocumentId: dto.sourceDocumentId,
              sourcePaymentId: dto.sourcePaymentId,
              totalDebit,
              totalCredit,
              status: options?.autoPost ? 'POSTED' : 'DRAFT',
              postedAt: options?.autoPost ? new Date() : null,
              postedBy: options?.autoPost ? userId : null,
              createdBy: userId,
              lines: {
                create: dto.lines.map((l, i) => ({
                  accountId: l.accountId,
                  lineNumber: i + 1,
                  description: l.description,
                  debit: Number(l.debit) || 0,
                  credit: Number(l.credit) || 0,
                  foreignAmount: l.foreignAmount,
                  exchangeRate: l.exchangeRate,
                })),
              },
            },
            include: { lines: { include: { account: true } } },
          });

          return entry;
        });
      } catch (e: any) {
        lastError = e;
        // Only retry on the journalNumber unique-constraint conflict, and only
        // when the caller didn't supply an explicit number (otherwise retrying
        // would just collide again).
        const isUniqueConflict =
          e?.code === 'P2002' &&
          Array.isArray(e?.meta?.target) &&
          (e.meta.target as string[]).some((t) => t === 'journalNumber');
        if (!isUniqueConflict || dto.journalNumber) throw e;
        // Loop again — nextJournalNumber will now see our colliding row as
        // the new highest and pick the next one.
      }
    }
    throw lastError;
  }

  // ---------- Read ----------

  async findAll(
    organizationId: string,
    opts?: {
      status?: string;
      type?: string;
      startDate?: Date;
      endDate?: Date;
      sourceDocumentId?: string;
      sourcePaymentId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = opts?.page ?? 1;
    const limit = opts?.limit ?? 50;
    const where: any = { organizationId };
    if (opts?.status) where.status = opts.status;
    if (opts?.type) where.type = opts.type;
    if (opts?.sourceDocumentId) where.sourceDocumentId = opts.sourceDocumentId;
    if (opts?.sourcePaymentId) where.sourcePaymentId = opts.sourcePaymentId;
    if (opts?.startDate || opts?.endDate) {
      where.entryDate = {};
      if (opts.startDate) where.entryDate.gte = opts.startDate;
      if (opts.endDate) where.entryDate.lte = opts.endDate;
    }

    const [items, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        orderBy: [{ entryDate: 'desc' }, { journalNumber: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { lines: { include: { account: true } } },
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(organizationId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, organizationId },
      include: { lines: { include: { account: true } } },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    return entry;
  }

  // ---------- Post / Void ----------

  async post(organizationId: string, id: string, userId?: string) {
    const entry = await this.findOne(organizationId, id);
    if (entry.status === 'POSTED') return entry;
    if (entry.status === 'VOID') throw new BadRequestException('Cannot post a voided entry');
    return this.prisma.journalEntry.update({
      where: { id },
      data: { status: 'POSTED', postedAt: new Date(), postedBy: userId },
      include: { lines: { include: { account: true } } },
    });
  }

  async void(organizationId: string, id: string, userId?: string) {
    const entry = await this.findOne(organizationId, id);
    if (entry.status === 'VOID') return entry;

    return this.prisma.$transaction(async (tx) => {
      // Mark original as void
      const voided = await tx.journalEntry.update({
        where: { id },
        data: { status: 'VOID', voidedAt: new Date(), voidedBy: userId },
      });

      // Create reversing entry only if it had been posted
      if (entry.status === 'POSTED') {
        const reverseNumber = await this.nextJournalNumber(organizationId);
        await tx.journalEntry.create({
          data: {
            organizationId,
            journalNumber: reverseNumber,
            entryDate: new Date(),
            type: 'ADJUSTMENT',
            reference: `Reversal of ${entry.journalNumber}`,
            description: `Reversing entry for ${entry.journalNumber}`,
            currency: entry.currency,
            totalDebit: entry.totalCredit, // swapped
            totalCredit: entry.totalDebit,
            status: 'POSTED',
            postedAt: new Date(),
            postedBy: userId,
            reversesEntryId: entry.id,
            createdBy: userId,
            lines: {
              create: entry.lines.map((l, i) => ({
                accountId: l.accountId,
                lineNumber: i + 1,
                description: `Reversal: ${l.description ?? ''}`.trim(),
                debit: l.credit,
                credit: l.debit,
              })),
            },
          },
        });
      }

      return voided;
    });
  }

  // ---------- Reports ----------

  async trialBalance(organizationId: string, asOfDate?: Date) {
    const asOf = asOfDate ?? new Date();
    const where: any = { organizationId, status: 'POSTED', entryDate: { lte: asOf } };

    // Fiscal-year-end drives the P&L → Retained Earnings rollover (Xero-style):
    // P&L accounts show only the CURRENT fiscal year; prior years' net profit is
    // rolled into Retained Earnings so the TB presents like Xero.
    const setting = await this.prisma.accountingSetting.findUnique({
      where: { organizationId },
      select: { fiscalYearEndDay: true, fiscalYearEndMonth: true, controlAccounts: true },
    });
    const fyEndDay = setting?.fiscalYearEndDay ?? 31;
    const fyEndMonth = setting?.fiscalYearEndMonth ?? 12;
    const reCode = (setting?.controlAccounts as any)?.retainedProfits || '960';
    const fyStart = fiscalYearStart(asOf, fyEndMonth, fyEndDay);

    // Aggregate in Postgres (SUM per account) — all-time-to-asOf + current-FY.
    const [grouped, currentGrouped, accounts] = await Promise.all([
      this.prisma.journalEntryLine.groupBy({ by: ['accountId'], where: { journalEntry: where }, _sum: { debit: true, credit: true } }),
      this.prisma.journalEntryLine.groupBy({
        by: ['accountId'],
        where: { journalEntry: { organizationId, status: 'POSTED', entryDate: { gte: fyStart, lte: asOf } } },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.chartOfAccount.findMany({
        where: { organizationId },
        select: { id: true, code: true, name: true, category: true, accountType: true, normalBalance: true },
      }),
    ]);

    const acctById = new Map(accounts.map((a) => [a.id, a]));
    const curById = new Map(currentGrouped.map((g) => [g.accountId, { debit: ROUND(g._sum.debit ?? 0), credit: ROUND(g._sum.credit ?? 0) }]));

    let priorProfit = 0; // credit-positive: prior-year revenue − expense
    const rows = grouped
      .map((g) => {
        const a = acctById.get(g.accountId);
        if (!a) return null;
        let debit = ROUND(g._sum.debit ?? 0);
        let credit = ROUND(g._sum.credit ?? 0);
        if (a.category === 'PNL') {
          // Split: prior-year portion rolls to RE; the row shows current FY only.
          const cur = curById.get(g.accountId) || { debit: 0, credit: 0 };
          const priorDebit = ROUND(debit - cur.debit);
          const priorCredit = ROUND(credit - cur.credit);
          priorProfit = ROUND(priorProfit + (priorCredit - priorDebit));
          debit = cur.debit;
          credit = cur.credit;
        }
        const balance = ROUND(a.normalBalance === 'DEBIT' ? debit - credit : credit - debit);
        return { accountId: a.id, code: a.code, name: a.name, category: a.category, accountType: a.accountType, normalBalance: a.normalBalance, debit, credit, balance };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Roll accumulated prior-year P&L into Retained Earnings (create the row if
    // the account exists but had no direct activity).
    if (Math.abs(priorProfit) >= 0.005) {
      let re = rows.find((r) => r.code === reCode);
      if (!re) {
        const reAcct = accounts.find((a) => a.code === reCode);
        if (reAcct) {
          re = { accountId: reAcct.id, code: reAcct.code, name: reAcct.name, category: reAcct.category, accountType: reAcct.accountType, normalBalance: reAcct.normalBalance, debit: 0, credit: 0, balance: 0 };
          rows.push(re);
        }
      }
      if (re) {
        if (priorProfit >= 0) re.credit = ROUND(re.credit + priorProfit);
        else re.debit = ROUND(re.debit - priorProfit);
        re.balance = ROUND(re.normalBalance === 'DEBIT' ? re.debit - re.credit : re.credit - re.debit);
      }
    }

    rows.sort((a, b) => a.code.localeCompare(b.code));

    const totalDebit = ROUND(rows.reduce((s, r) => s + r.debit, 0));
    const totalCredit = ROUND(rows.reduce((s, r) => s + r.credit, 0));

    return { asOfDate: asOfDate ?? null, rows, totalDebit, totalCredit, isBalanced: Math.abs(totalDebit - totalCredit) < 0.02 };
  }

  async generalLedger(organizationId: string, accountId: string, opts?: { startDate?: Date; endDate?: Date }) {
    const account = await this.prisma.chartOfAccount.findFirst({ where: { id: accountId, organizationId } });
    if (!account) throw new NotFoundException('Account not found');

    const baseWhere: any = { organizationId, status: 'POSTED' };

    // Opening balance = posted activity strictly before startDate
    let openingBalance = 0;
    if (opts?.startDate) {
      const priorLines = await this.prisma.journalEntryLine.findMany({
        where: {
          accountId,
          journalEntry: { ...baseWhere, entryDate: { lt: opts.startDate } },
        },
      });
      const priorDebit = priorLines.reduce((s, l) => s + l.debit, 0);
      const priorCredit = priorLines.reduce((s, l) => s + l.credit, 0);
      openingBalance = account.normalBalance === 'DEBIT' ? priorDebit - priorCredit : priorCredit - priorDebit;
    }

    const where: any = { accountId, journalEntry: baseWhere };
    if (opts?.startDate || opts?.endDate) {
      where.journalEntry = {
        ...baseWhere,
        entryDate: {
          ...(opts?.startDate ? { gte: opts.startDate } : {}),
          ...(opts?.endDate ? { lte: opts.endDate } : {}),
        },
      };
    }

    const lines = await this.prisma.journalEntryLine.findMany({
      where,
      include: { journalEntry: true },
      orderBy: { journalEntry: { entryDate: 'asc' } },
    });

    let running = openingBalance;
    const rows = lines.map((l) => {
      const delta = account.normalBalance === 'DEBIT' ? l.debit - l.credit : l.credit - l.debit;
      running += delta;
      return {
        journalEntryId: l.journalEntryId,
        journalNumber: l.journalEntry.journalNumber,
        entryDate: l.journalEntry.entryDate,
        type: l.journalEntry.type,
        reference: l.journalEntry.reference,
        description: l.description ?? l.journalEntry.description,
        debit: ROUND(l.debit),
        credit: ROUND(l.credit),
        balance: ROUND(running),
      };
    });

    return {
      account: { id: account.id, code: account.code, name: account.name, normalBalance: account.normalBalance },
      openingBalance: ROUND(openingBalance),
      closingBalance: ROUND(running),
      rows,
    };
  }

  // ---------- Finance Hub aggregate ----------
  // Single round-trip aggregate for the Hub dashboard: KPIs across MTD / YTD /
  // as-of-now + an Action Queue feed and surfaced anomalies. Wraps the existing
  // trial-balance / P&L / GST methods so we have one source of truth for each
  // computation.
  async hubSnapshot(organizationId: string, now: Date = new Date()) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    // 1) Trial balance as-of-now → cash & AR & AP control account balances
    const tb = await this.trialBalance(organizationId, now);

    const settings = await this.prisma.accountingSetting.findUnique({
      where: { organizationId },
    });
    const controls = (settings?.controlAccounts as any) || {};
    const debtorCode = controls.debtorControl || 'CA001';
    const creditorCode = controls.creditorControl || 'CL001';
    const taxCode = controls.taxLiabilities || 'CL900';

    const cashRows = tb.rows.filter((r) => this.isCashOrBankAccount(r));
    const cashBalance = cashRows.reduce((s, r) => s + r.balance, 0);
    const arBalance = tb.rows.find((r) => r.code === debtorCode)?.balance ?? 0;
    const apBalance = tb.rows.find((r) => r.code === creditorCode)?.balance ?? 0;
    const taxOutstanding = tb.rows.find((r) => r.code === taxCode)?.balance ?? 0;

    // 2) Period activity → Revenue MTD/YTD, Net Profit MTD/YTD
    const [mtdActivity, ytdActivity, prevMonthActivity] = await Promise.all([
      this.accountActivity(organizationId, { startDate: monthStart, endDate: now }),
      this.accountActivity(organizationId, { startDate: yearStart, endDate: now }),
      this.accountActivity(organizationId, { startDate: prevMonthStart, endDate: prevMonthEnd }),
    ]);

    const sumBalance = (rows: any[], types: string[]) =>
      rows.filter((r) => types.includes(r.accountType)).reduce((s, r) => s + r.balance, 0);

    const REVENUE_TYPES = ['SALES', 'INCOME'];
    const EXPENSE_TYPES = ['EXPENSE', 'EXCHANGE_GAIN_LOSS', 'PURCHASE', 'TAX'];

    const revenueMtd = sumBalance(mtdActivity, REVENUE_TYPES);
    const revenueYtd = sumBalance(ytdActivity, REVENUE_TYPES);
    const revenuePrev = sumBalance(prevMonthActivity, REVENUE_TYPES);
    const netProfitMtd = revenueMtd - sumBalance(mtdActivity, EXPENSE_TYPES);
    const netProfitYtd = revenueYtd - sumBalance(ytdActivity, EXPENSE_TYPES);
    const netProfitPrev = revenuePrev - sumBalance(prevMonthActivity, EXPENSE_TYPES);

    const pctChange = (curr: number, prev: number) =>
      prev === 0 ? null : ROUND(((curr - prev) / Math.abs(prev)) * 100);

    // 3) Action Queue feed — concrete unhandled-thing counts the user can act on.
    const [draftJournalCount, unpostedConfirmedDocsCount, unbalancedDrafts] = await Promise.all([
      this.prisma.journalEntry.count({ where: { organizationId, status: 'DRAFT' } }),
      // Confirmed documents (CN/DN/PO/PR/TI) that don't yet have a matching POSTED
      // journal entry. The auto-post pipeline should have handled these, so any
      // count > 0 indicates a real issue.
      this.prisma.document.count({
        where: {
          organizationId,
          status: 'paid',
          type: { in: ['INVOICE', 'TI'] },
          NOT: {
            id: {
              in: (
                await this.prisma.journalEntry.findMany({
                  where: { organizationId, status: 'POSTED', type: 'INVOICE' },
                  select: { sourceDocumentId: true },
                })
              )
                .map((j) => j.sourceDocumentId)
                .filter((id): id is string => !!id),
            },
          },
        },
      }),
      this.prisma.journalEntry.findMany({
        where: { organizationId, status: 'DRAFT' },
        select: { id: true, journalNumber: true, totalDebit: true, totalCredit: true },
      }),
    ]);

    const outOfBalanceDrafts = unbalancedDrafts.filter(
      (e) => ROUND(e.totalDebit - e.totalCredit) !== 0,
    );

    const actionQueue: Array<{
      severity: 'info' | 'warning' | 'error';
      title: string;
      detail?: string;
      count?: number;
      link?: string;
    }> = [];

    if (draftJournalCount > 0) {
      actionQueue.push({
        severity: 'info',
        title: `${draftJournalCount} draft journal ${draftJournalCount === 1 ? 'entry' : 'entries'} pending review`,
        count: draftJournalCount,
        link: '/portal/accounting/reports?tab=audit',
      });
    }
    if (unpostedConfirmedDocsCount > 0) {
      actionQueue.push({
        severity: 'warning',
        title: `${unpostedConfirmedDocsCount} confirmed ${unpostedConfirmedDocsCount === 1 ? 'invoice has' : 'invoices have'} not posted to GL`,
        detail: 'Auto-post should have caught these — needs investigation',
        count: unpostedConfirmedDocsCount,
        link: '/portal/accounting/reports?tab=audit',
      });
    }
    if (outOfBalanceDrafts.length > 0) {
      actionQueue.push({
        severity: 'error',
        title: `${outOfBalanceDrafts.length} draft ${outOfBalanceDrafts.length === 1 ? 'entry is' : 'entries are'} out of balance`,
        count: outOfBalanceDrafts.length,
        link: '/portal/accounting/reports?tab=audit',
      });
    }
    if (taxOutstanding > 0) {
      actionQueue.push({
        severity: 'info',
        title: `GST payable: ${taxOutstanding.toFixed(2)} — ready to file`,
        link: '/portal/accounting/reports?tab=gst',
      });
    }

    // Anomaly detector findings — flagged duplicate invoices, stale drafts,
    // missing-tax-on-invoice, outlier amounts, etc. Pushed to the same queue.
    // Best-effort and time-boxed: on a large GL these detectors can be slow, and
    // they must never hang or break the Hub — the KPIs above are what matters.
    try {
      const anomalyFindings = await Promise.race([
        this.anomalies.runAll(organizationId, now),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('anomaly-timeout')), 8000),
        ),
      ]);
      actionQueue.push(...anomalyFindings);
    } catch {
      // Skip anomalies this load — Hub still returns KPIs + the deterministic
      // action-queue items computed above.
    }

    // 4) Insights — simple heuristic explanations.
    const insights: Array<{ tone: 'positive' | 'negative' | 'neutral'; text: string }> = [];

    const revPct = pctChange(revenueMtd, revenuePrev);
    if (revPct !== null && Math.abs(revPct) >= 10) {
      insights.push({
        tone: revPct > 0 ? 'positive' : 'negative',
        text: `Revenue MTD is ${Math.abs(revPct).toFixed(0)}% ${revPct > 0 ? 'higher' : 'lower'} than last month (${revenueMtd.toFixed(2)} vs ${revenuePrev.toFixed(2)})`,
      });
    }
    const profitPct = pctChange(netProfitMtd, netProfitPrev);
    if (profitPct !== null && Math.abs(profitPct) >= 15) {
      insights.push({
        tone: profitPct > 0 ? 'positive' : 'negative',
        text: `Net profit MTD ${profitPct > 0 ? 'up' : 'down'} ${Math.abs(profitPct).toFixed(0)}% vs last month`,
      });
    }
    if (arBalance > cashBalance && arBalance > 0) {
      insights.push({
        tone: 'neutral',
        text: `Customers owe you ${arBalance.toFixed(2)} — more than your cash on hand. Consider collections push.`,
      });
    }
    if (apBalance > cashBalance && apBalance > 0) {
      insights.push({
        tone: 'negative',
        text: `You owe suppliers ${apBalance.toFixed(2)} — exceeds your cash position.`,
      });
    }

    return {
      asOf: now.toISOString(),
      kpis: {
        revenueMtd: ROUND(revenueMtd),
        revenueYtd: ROUND(revenueYtd),
        revenueMtdChange: revPct,
        netProfitMtd: ROUND(netProfitMtd),
        netProfitYtd: ROUND(netProfitYtd),
        netProfitMtdChange: profitPct,
        cashBalance: ROUND(cashBalance),
        arBalance: ROUND(arBalance),
        apBalance: ROUND(apBalance),
        taxOutstanding: ROUND(taxOutstanding),
      },
      actionQueue,
      insights,
    };
  }

  // ---------- P&L / Balance Sheet helpers ----------

  // Sum debits/credits per account between (startDate, endDate]. Used as the
  // building block for both P&L (period activity) and Balance Sheet (cumulative).
  // Public wrapper so the GL summary report can read per-account period
  // movements (the underlying helper is also used by P&L / Balance Sheet).
  async accountActivityReport(organizationId: string, opts: { startDate?: Date; endDate?: Date }) {
    return this.accountActivity(organizationId, opts);
  }

  private async accountActivity(
    organizationId: string,
    opts: { startDate?: Date; endDate?: Date },
  ) {
    const dateFilter: any = {};
    if (opts.startDate) dateFilter.gte = opts.startDate;
    if (opts.endDate) dateFilter.lte = opts.endDate;

    // Aggregate per-account in Postgres rather than streaming every line into
    // Node (see trialBalance for the same rationale).
    const [grouped, accounts] = await Promise.all([
      this.prisma.journalEntryLine.groupBy({
        by: ['accountId'],
        where: {
          journalEntry: {
            organizationId,
            status: 'POSTED',
            ...(opts.startDate || opts.endDate ? { entryDate: dateFilter } : {}),
          },
        },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.chartOfAccount.findMany({
        where: { organizationId },
        select: { id: true, code: true, name: true, accountType: true, category: true, normalBalance: true },
      }),
    ]);

    const acctById = new Map(accounts.map((a) => [a.id, a]));

    return grouped
      .map((g) => {
        const a = acctById.get(g.accountId);
        if (!a) return null;
        const debit = ROUND(g._sum.debit ?? 0);
        const credit = ROUND(g._sum.credit ?? 0);
        return {
          id: a.id,
          code: a.code,
          name: a.name,
          accountType: a.accountType,
          category: a.category,
          normalBalance: a.normalBalance,
          debit,
          credit,
          balance: ROUND(a.normalBalance === 'DEBIT' ? debit - credit : credit - debit),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }

  // ---------- Foreign Bank Listing ----------
  // Foreign-currency bank/cash accounts: base-currency balance + accumulated
  // foreign balance (from FX-posted journal lines) as at a date. Accounts
  // qualify by FOREIGN_BANK type, or any bank/cash account that has ever been
  // touched by a foreign-currency posting.
  async foreignBankListing(organizationId: string, opts: { asOf?: Date }) {
    const asOf = opts.asOf ?? new Date();
    const eod = new Date(asOf);
    eod.setHours(23, 59, 59, 999);

    const accounts = (
      await this.prisma.chartOfAccount.findMany({
        where: { organizationId },
        select: { id: true, code: true, name: true, accountType: true },
      })
    ).filter((a) => a.accountType === 'FOREIGN_BANK' || this.isCashOrBankAccount(a));
    if (!accounts.length) return { asOf: asOf.toISOString(), rows: [] };
    const ids = accounts.map((a) => a.id);

    const [balances, fxLines] = await Promise.all([
      this.prisma.journalEntryLine.groupBy({
        by: ['accountId'],
        where: { accountId: { in: ids }, journalEntry: { organizationId, status: 'POSTED', entryDate: { lte: eod } } },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.journalEntryLine.findMany({
        where: {
          accountId: { in: ids },
          foreignAmount: { not: null },
          journalEntry: { organizationId, status: 'POSTED', entryDate: { lte: eod } },
        },
        select: { accountId: true, debit: true, credit: true, foreignAmount: true, journalEntry: { select: { currency: true } } },
      }),
    ]);
    const balById = new Map(balances.map((g) => [g.accountId, g._sum]));

    const fxByAccount = new Map<string, { currency: string; foreign: number }>();
    for (const l of fxLines) {
      const cur = l.journalEntry.currency || '';
      if (!cur) continue;
      const e = fxByAccount.get(l.accountId) || { currency: cur, foreign: 0 };
      e.currency = cur;
      e.foreign += (l.debit > 0 ? 1 : -1) * (l.foreignAmount ?? 0);
      fxByAccount.set(l.accountId, e);
    }

    const rows = accounts
      .map((a) => {
        const b: any = balById.get(a.id) || { debit: 0, credit: 0 };
        const fx = fxByAccount.get(a.id);
        return {
          accountId: a.id,
          code: a.code,
          name: a.name,
          accountType: a.accountType,
          baseBalance: ROUND((b.debit ?? 0) - (b.credit ?? 0)),
          currency: fx?.currency ?? null,
          foreignBalance: fx ? ROUND(fx.foreign) : null,
        };
      })
      // Only foreign-relevant accounts: typed FOREIGN_BANK or actually FX-touched.
      .filter((r) => r.accountType === 'FOREIGN_BANK' || r.currency)
      .sort((a, b) => a.name.localeCompare(b.name));

    return { asOf: asOf.toISOString(), rows };
  }

  // ---------- Xero-style Journal Report ----------
  // Posted journals in the period, each with its balanced lines — grouped per
  // journal like Xero ("ID <n> <narration>" → lines → Total).
  async journalReport(
    organizationId: string,
    opts: { startDate?: Date; endDate?: Date; orderBy?: 'journalNumber' | 'entryDate' | 'postedAt' },
  ) {
    const MAX_JOURNALS = 500;
    const eod = opts.endDate ? new Date(opts.endDate) : new Date();
    eod.setHours(23, 59, 59, 999);
    const orderBy =
      opts.orderBy === 'entryDate'
        ? [{ entryDate: 'asc' as const }, { journalNumber: 'asc' as const }]
        : opts.orderBy === 'postedAt'
          ? [{ postedAt: 'asc' as const }]
          : [{ journalNumber: 'asc' as const }];

    const entries = await this.prisma.journalEntry.findMany({
      where: {
        organizationId,
        status: 'POSTED',
        entryDate: { ...(opts.startDate ? { gte: opts.startDate } : {}), lte: eod },
      },
      include: {
        lines: { include: { account: { select: { code: true, name: true } } }, orderBy: { lineNumber: 'asc' } },
      },
      orderBy,
      take: MAX_JOURNALS + 1,
    });
    const truncated = entries.length > MAX_JOURNALS;
    if (truncated) entries.pop();

    const journals = entries.map((e) => ({
      id: e.id,
      journalNumber: e.journalNumber,
      entryDate: e.entryDate.toISOString(),
      type: e.type,
      reference: e.reference ?? '',
      description: e.description ?? '',
      postedAt: e.postedAt?.toISOString() ?? null,
      postedBy: e.postedBy ?? e.createdBy ?? '',
      totalDebit: ROUND(e.totalDebit),
      totalCredit: ROUND(e.totalCredit),
      lines: e.lines.map((l) => ({
        date: e.entryDate.toISOString(),
        accountCode: l.account.code,
        account: l.account.name,
        description: l.description ?? '',
        debit: ROUND(l.debit),
        credit: ROUND(l.credit),
      })),
    }));
    return {
      journals,
      journalCount: journals.length,
      truncated,
      totals: {
        debit: ROUND(journals.reduce((s, j) => s + j.totalDebit, 0)),
        credit: ROUND(journals.reduce((s, j) => s + j.totalCredit, 0)),
      },
    };
  }

  // ---------- Xero-style Bank Summary ----------
  // Per bank/cash account: opening balance, cash received (debits), cash
  // spent (credits), closing balance for the period.
  async bankSummary(organizationId: string, opts: { startDate?: Date; endDate?: Date }) {
    const accounts = (
      await this.prisma.chartOfAccount.findMany({
        where: { organizationId },
        select: { id: true, code: true, name: true, accountType: true },
      })
    ).filter((a) => this.isCashOrBankAccount(a));
    if (!accounts.length) return { rows: [], totals: { opening: 0, received: 0, spent: 0, closing: 0 } };
    const ids = accounts.map((a) => a.id);

    const eod = opts.endDate ? new Date(opts.endDate) : new Date();
    eod.setHours(23, 59, 59, 999);

    const [before, inRange] = await Promise.all([
      opts.startDate
        ? this.prisma.journalEntryLine.groupBy({
            by: ['accountId'],
            where: { accountId: { in: ids }, journalEntry: { organizationId, status: 'POSTED', entryDate: { lt: opts.startDate } } },
            _sum: { debit: true, credit: true },
          })
        : Promise.resolve([] as any[]),
      this.prisma.journalEntryLine.groupBy({
        by: ['accountId'],
        where: {
          accountId: { in: ids },
          journalEntry: { organizationId, status: 'POSTED', entryDate: { ...(opts.startDate ? { gte: opts.startDate } : {}), lte: eod } },
        },
        _sum: { debit: true, credit: true },
      }),
    ]);
    const beforeById = new Map(before.map((g: any) => [g.accountId, g._sum]));
    const rangeById = new Map(inRange.map((g: any) => [g.accountId, g._sum]));

    const rows = accounts
      .map((a) => {
        const b: any = beforeById.get(a.id) || { debit: 0, credit: 0 };
        const r: any = rangeById.get(a.id) || { debit: 0, credit: 0 };
        const opening = ROUND((b.debit ?? 0) - (b.credit ?? 0));
        const received = ROUND(r.debit ?? 0);
        const spent = ROUND(r.credit ?? 0);
        return {
          accountId: a.id,
          code: a.code,
          name: a.name,
          accountType: a.accountType,
          opening,
          received,
          spent,
          closing: ROUND(opening + received - spent),
        };
      })
      .filter((r) => Math.abs(r.opening) > 0.005 || r.received > 0.005 || r.spent > 0.005)
      .sort((a, b) => a.name.localeCompare(b.name));

    const totals = rows.reduce(
      (s, r) => ({ opening: s.opening + r.opening, received: s.received + r.received, spent: s.spent + r.spent, closing: s.closing + r.closing }),
      { opening: 0, received: 0, spent: 0, closing: 0 },
    );
    return {
      rows,
      totals: { opening: ROUND(totals.opening), received: ROUND(totals.received), spent: ROUND(totals.spent), closing: ROUND(totals.closing) },
    };
  }

  // ---------- Xero-style General Ledger Detail ----------
  // Every posted line in the period, grouped per account, with a Xero-style
  // running balance that starts at ZERO at period start (movement within the
  // period — matches Xero's GL Detail, which shows Net Movement per account).
  async glDetailReport(
    organizationId: string,
    opts: { startDate?: Date; endDate?: Date; accountIds?: string[] },
  ) {
    const MAX_LINES = 5000;
    const dateFilter: any = {};
    if (opts.startDate) dateFilter.gte = opts.startDate;
    if (opts.endDate) {
      const eod = new Date(opts.endDate);
      eod.setHours(23, 59, 59, 999);
      dateFilter.lte = eod;
    }

    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        ...(opts.accountIds?.length ? { accountId: { in: opts.accountIds } } : {}),
        journalEntry: {
          organizationId,
          status: 'POSTED',
          ...(opts.startDate || opts.endDate ? { entryDate: dateFilter } : {}),
        },
      },
      include: {
        journalEntry: { select: { journalNumber: true, entryDate: true, type: true, reference: true, description: true } },
        account: { select: { id: true, code: true, name: true, accountType: true } },
      },
      orderBy: [{ journalEntry: { entryDate: 'asc' } }, { lineNumber: 'asc' }],
      take: MAX_LINES + 1,
    });
    const truncated = lines.length > MAX_LINES;
    if (truncated) lines.pop();

    const SOURCE_LABEL: Record<string, string> = {
      INVOICE: 'Receivable Invoice',
      BILL: 'Payable Invoice',
      PAYMENT: 'Payment',
      CREDIT_NOTE: 'Credit Note',
      DEBIT_NOTE: 'Debit Note',
      PURCHASE_ORDER: 'Purchase Order',
      PURCHASE_RETURN: 'Purchase Return',
      MANUAL: 'Manual Journal',
      OPENING_BALANCE: 'Opening Balance',
      ADJUSTMENT: 'Adjustment',
    };

    const byAccount = new Map<string, { code: string; name: string; accountType: string; rows: any[]; debit: number; credit: number }>();
    for (const l of lines) {
      const a = l.account;
      const e = byAccount.get(a.id) || { code: a.code, name: a.name, accountType: a.accountType, rows: [], debit: 0, credit: 0 };
      e.rows.push({
        date: l.journalEntry.entryDate.toISOString(),
        source: SOURCE_LABEL[l.journalEntry.type] || l.journalEntry.type,
        description: l.description ?? l.journalEntry.description ?? '',
        reference: l.journalEntry.reference ?? l.journalEntry.journalNumber,
        journalNumber: l.journalEntry.journalNumber,
        debit: ROUND(l.debit),
        credit: ROUND(l.credit),
      });
      e.debit += l.debit;
      e.credit += l.credit;
      byAccount.set(a.id, e);
    }

    const groups = [...byAccount.entries()]
      .map(([accountId, e]) => {
        let running = 0;
        for (const r of e.rows) {
          running = ROUND(running + r.debit - r.credit);
          r.runningBalance = running;
        }
        return {
          accountId,
          code: e.code,
          name: e.name,
          accountType: e.accountType,
          rows: e.rows,
          totalDebit: ROUND(e.debit),
          totalCredit: ROUND(e.credit),
          netMovement: ROUND(e.debit - e.credit),
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    return {
      period: { startDate: opts.startDate?.toISOString() ?? null, endDate: opts.endDate?.toISOString() ?? null },
      groups,
      totals: {
        debit: ROUND(groups.reduce((s, g) => s + g.totalDebit, 0)),
        credit: ROUND(groups.reduce((s, g) => s + g.totalCredit, 0)),
      },
      lineCount: lines.length,
      truncated,
    };
  }

  // ---------- Profit & Loss report ----------
  // Returns three columns: this month, previous month, year-to-date — all
  // anchored on the cut-off date. Closing stock is user-supplied (the legacy
  // 'Closing Stock' filter); without it, COGS will overstate by the Opening
  // Stock that's still on the balance sheet.
  async profitLossReport(
    organizationId: string,
    opts: { cutOffDate: Date; closingStock?: number },
  ) {
    const { cutOffDate } = opts;
    const closingStock = opts.closingStock ?? 0;

    const monthStart = new Date(cutOffDate.getFullYear(), cutOffDate.getMonth(), 1);
    const prevMonthStart = new Date(cutOffDate.getFullYear(), cutOffDate.getMonth() - 1, 1);
    const prevMonthEnd = new Date(cutOffDate.getFullYear(), cutOffDate.getMonth(), 0, 23, 59, 59, 999);
    const yearStart = new Date(cutOffDate.getFullYear(), 0, 1);

    const [thisMonth, prevMonth, ytd] = await Promise.all([
      this.accountActivity(organizationId, { startDate: monthStart, endDate: cutOffDate }),
      this.accountActivity(organizationId, { startDate: prevMonthStart, endDate: prevMonthEnd }),
      this.accountActivity(organizationId, { startDate: yearStart, endDate: cutOffDate }),
    ]);

    const monthLabel = (d: Date) =>
      d.toLocaleString('en-US', { month: 'short', year: 'numeric' }).toUpperCase();
    const columns = [
      { key: 'thisMonth', label: monthLabel(monthStart), data: thisMonth },
      { key: 'prevMonth', label: monthLabel(prevMonthStart), data: prevMonth },
      { key: 'ytd', label: 'Year-to-Date', data: ytd },
    ];

    // For each column, build aggregates by accountType.
    const PNL_TYPES = {
      sales: ['SALES'],
      otherIncome: ['INCOME'],
      purchases: ['PURCHASE'],
      expenses: ['EXPENSE', 'EXCHANGE_GAIN_LOSS'],
      tax: ['TAX'],
      extraordinary: ['EXTRAORDINARY'],
    };

    const sumByTypes = (data: any[], types: string[]) =>
      data.filter((r) => types.includes(r.accountType)).reduce((s, r) => s + r.balance, 0);

    const accountsByTypes = (data: any[], types: string[]) =>
      data
        .filter((r) => types.includes(r.accountType))
        .map((r) => ({ code: r.code, name: r.name, balance: r.balance }))
        .sort((a, b) => a.code.localeCompare(b.code));

    // Build the section structure with values for all three columns.
    const buildSection = (
      title: string,
      types: string[],
      subtotalLabel: string,
    ) => {
      // Union of accounts that appear in any of the three columns.
      const codeMap = new Map<string, { code: string; name: string }>();
      for (const col of columns) {
        for (const r of accountsByTypes(col.data, types)) codeMap.set(r.code, r);
      }
      const rows = Array.from(codeMap.values())
        .map((meta) => ({
          code: meta.code,
          name: meta.name,
          values: columns.map((col) => {
            const found = col.data.find((r) => r.code === meta.code && types.includes(r.accountType));
            return ROUND(found?.balance ?? 0);
          }),
        }))
        .sort((a, b) => a.code.localeCompare(b.code));

      return {
        title,
        rows,
        subtotal: {
          label: subtotalLabel,
          values: columns.map((col) => ROUND(sumByTypes(col.data, types))),
        },
      };
    };

    // Opening stock — fetched from AccountingSetting if available; otherwise 0.
    // The legacy treats this as a manually-entered figure; expose it but default
    // to whatever the org configured.
    const settings = await this.prisma.accountingSetting.findUnique({ where: { organizationId } });
    const openingStock = ROUND(settings?.yearOpeningStock ?? 0);

    // Sections.
    const salesSection = buildSection('Sales', PNL_TYPES.sales, 'TOTAL SALES');
    const purchasesValues = columns.map((col) => ROUND(sumByTypes(col.data, PNL_TYPES.purchases)));

    // COGS = Opening Stock + Purchases - Closing Stock.
    // Opening stock is a year-start figure; only material in the YTD column.
    const openingStockValues = [0, 0, openingStock];
    const closingStockValues = [-closingStock, -closingStock, -closingStock];
    const cogsValues = purchasesValues.map(
      (p, i) => ROUND(openingStockValues[i] + p + closingStockValues[i]),
    );

    const grossProfit = salesSection.subtotal.values.map((s, i) => ROUND(s - cogsValues[i]));

    const otherIncomeSection = buildSection('Other Income', PNL_TYPES.otherIncome, 'TOTAL INCOME');
    const expensesSection = buildSection('Expenses', PNL_TYPES.expenses, 'TOTAL EXPENSES');
    const taxSection = buildSection('Tax', PNL_TYPES.tax, 'TOTAL TAX');

    const operationalNet = grossProfit.map((gp, i) =>
      ROUND(gp + otherIncomeSection.subtotal.values[i] - expensesSection.subtotal.values[i]),
    );

    return {
      cutOffDate: cutOffDate.toISOString(),
      closingStock,
      openingStock,
      columns: columns.map(({ key, label }) => ({ key, label })),
      sales: salesSection,
      cogs: {
        title: 'Cost of Goods Sold',
        rows: [
          { code: '__OPEN', name: 'OPENING STOCK', values: openingStockValues },
          {
            code: '__PURCH',
            name: 'PURCHASES',
            values: purchasesValues,
            children: salesSection.rows.length > 0 ? undefined : undefined,
          },
          { code: '__CLOSE', name: 'CLOSING STOCK', values: closingStockValues },
        ],
        subtotal: { label: 'COST OF GOODS SOLD', values: cogsValues },
      },
      grossProfit: { label: 'GROSS PROFIT', values: grossProfit },
      otherIncome: otherIncomeSection,
      expenses: expensesSection,
      tax: taxSection,
      operationalNet: {
        label: 'OPERATIONAL NET PROFIT BEFORE TAX',
        values: operationalNet,
      },
    };
  }

  // ---------- Cash Flow Statement (indirect method) ----------
  // Computes cash flow from operations, investing, and financing by taking
  // net income for the period and adjusting for changes in non-cash working
  // capital accounts + non-operating BS movements between the start and end
  // dates. Pure-derived — no schema, no manual input.
  async cashFlowReport(
    organizationId: string,
    opts: { startDate: Date; endDate: Date },
  ) {
    const { startDate, endDate } = opts;

    // Beginning and ending balance for every BS account.
    const [beginActivity, endActivity, periodActivity] = await Promise.all([
      this.accountActivity(organizationId, { endDate: new Date(startDate.getTime() - 1) }),
      this.accountActivity(organizationId, { endDate }),
      this.accountActivity(organizationId, { startDate, endDate }),
    ]);

    const balByAccountId = (data: any[]) => {
      const m = new Map<string, { code: string; name: string; accountType: string; balance: number }>();
      for (const r of data) m.set(r.id, { code: r.code, name: r.name, accountType: r.accountType, balance: r.balance });
      return m;
    };

    const beginMap = balByAccountId(beginActivity);
    const endMap = balByAccountId(endActivity);

    // Movement per account = end balance - begin balance.
    const accountIds = new Set([...beginMap.keys(), ...endMap.keys()]);
    const movements: Array<{ code: string; name: string; accountType: string; movement: number }> = [];
    for (const id of accountIds) {
      const e = endMap.get(id) ?? { code: beginMap.get(id)!.code, name: beginMap.get(id)!.name, accountType: beginMap.get(id)!.accountType, balance: 0 };
      const b = beginMap.get(id) ?? { code: e.code, name: e.name, accountType: e.accountType, balance: 0 };
      const movement = ROUND(e.balance - b.balance);
      if (movement === 0) continue;
      movements.push({ code: e.code, name: e.name, accountType: e.accountType, movement });
    }

    // Net income for the period from P&L accounts.
    const REVENUE_TYPES = ['SALES', 'INCOME'];
    const EXPENSE_TYPES = ['EXPENSE', 'EXCHANGE_GAIN_LOSS', 'PURCHASE', 'TAX', 'EXTRAORDINARY'];
    const periodRevenue = periodActivity
      .filter((r) => REVENUE_TYPES.includes(r.accountType))
      .reduce((s, r) => s + r.balance, 0);
    const periodExpense = periodActivity
      .filter((r) => EXPENSE_TYPES.includes(r.accountType))
      .reduce((s, r) => s + r.balance, 0);
    const netIncome = ROUND(periodRevenue - periodExpense);

    // Working capital movements (operating).
    // AR — increase reduces cash. Inventory — increase reduces cash.
    // AP / accrued — increase boosts cash. Cash itself is excluded; that's
    // the bottom-line we're reconciling to, not an adjustment.
    const operatingMovements = movements.filter(
      (m) =>
        !this.isCashOrBankAccount(m) &&
        (m.accountType === 'CURRENT_ASSET' ||
          m.accountType === 'CURRENT_LIABILITY' ||
          m.accountType === 'TAX_LIABILITY'),
    );

    // For current assets: balance increase = cash decrease (sign-flip).
    // For current liabilities: balance increase = cash increase.
    const operatingAdjustments = operatingMovements.map((m) => {
      const isAsset = m.accountType === 'CURRENT_ASSET';
      const cashImpact = isAsset ? -m.movement : m.movement;
      return {
        code: m.code,
        name: m.name,
        movement: m.movement,
        cashImpact: ROUND(cashImpact),
      };
    });

    const operatingCash = ROUND(
      netIncome + operatingAdjustments.reduce((s, m) => s + m.cashImpact, 0),
    );

    // Investing: changes in fixed/intangible assets.
    const investingMovements = movements.filter(
      (m) => m.accountType === 'FIXED_ASSET' || m.accountType === 'INTANGIBLE_ASSET' || m.accountType === 'DEPRECIATION_PROVISION',
    );
    const investingCash = ROUND(
      investingMovements.reduce((s, m) => {
        // FA/IA increase = cash out; depreciation provision increase = no cash
        const isProvision = m.accountType === 'DEPRECIATION_PROVISION';
        return s + (isProvision ? 0 : -m.movement);
      }, 0),
    );

    // Financing: changes in equity / long-term liabilities.
    const financingMovements = movements.filter(
      (m) =>
        m.accountType === 'SHARE_CAPITAL' ||
        m.accountType === 'RETAINED_PROFIT' ||
        m.accountType === 'DIVIDEND' ||
        m.accountType === 'CAPITAL_RESERVE' ||
        m.accountType === 'MEDIUM_TERM_LIABILITY' ||
        m.accountType === 'LONG_TERM_LIABILITY',
    );
    const financingCash = ROUND(
      financingMovements.reduce((s, m) => {
        const isOutflow = m.accountType === 'DIVIDEND';
        return s + (isOutflow ? -m.movement : m.movement);
      }, 0),
    );

    // Beginning cash + net change = ending cash (verification).
    const beginningCash = ROUND(
      [...beginMap.values()].filter((r) => this.isCashOrBankAccount(r)).reduce((s, r) => s + r.balance, 0),
    );
    const endingCash = ROUND(
      [...endMap.values()].filter((r) => this.isCashOrBankAccount(r)).reduce((s, r) => s + r.balance, 0),
    );
    const netChange = ROUND(operatingCash + investingCash + financingCash);
    const reconciles = ROUND(beginningCash + netChange) === endingCash;

    return {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      operating: {
        netIncome,
        adjustments: operatingAdjustments,
        total: operatingCash,
      },
      investing: {
        movements: investingMovements.map((m) => ({ ...m, cashImpact: m.accountType === 'DEPRECIATION_PROVISION' ? 0 : ROUND(-m.movement) })),
        total: investingCash,
      },
      financing: {
        movements: financingMovements.map((m) => ({
          ...m,
          cashImpact: ROUND(m.accountType === 'DIVIDEND' ? -m.movement : m.movement),
        })),
        total: financingCash,
      },
      summary: {
        beginningCash,
        netChangeInCash: netChange,
        endingCash,
        reconciles,
        actualEndingCash: endingCash,
        reconciliationDiff: ROUND(beginningCash + netChange - endingCash),
      },
    };
  }

  // ---------- Balance Sheet report ----------
  // Cumulative balances for all balance-sheet accounts up to and including
  // the as-of date. Includes the period's net profit so the BS balances.
  async balanceSheetReport(
    organizationId: string,
    opts: { asOfDate: Date; closingStock?: number },
  ) {
    const { asOfDate } = opts;
    const closingStock = opts.closingStock ?? 0;

    const data = await this.accountActivity(organizationId, { endDate: asOfDate });

    // Year-start P&L → retained earnings (compute as sum of all P&L activity from
    // start of organization through asOfDate; the legacy posts a year-end close
    // entry to retained, but we don't post here — we just aggregate for display).
    const PNL_INCOME = ['SALES', 'INCOME'];
    const PNL_EXPENSE = ['PURCHASE', 'EXPENSE', 'TAX', 'EXCHANGE_GAIN_LOSS', 'EXTRAORDINARY'];
    const incomeTotal = data.filter((r) => PNL_INCOME.includes(r.accountType)).reduce((s, r) => s + r.balance, 0);
    const expenseTotal = data.filter((r) => PNL_EXPENSE.includes(r.accountType)).reduce((s, r) => s + r.balance, 0);
    const netProfitInPeriod = ROUND(incomeTotal - expenseTotal + closingStock);

    const buildSection = (title: string, types: string[]) => {
      const rows = data
        .filter((r) => types.includes(r.accountType))
        .map((r) => ({ code: r.code, name: r.name, balance: r.balance }))
        .sort((a, b) => a.code.localeCompare(b.code));
      const total = ROUND(rows.reduce((s, r) => s + r.balance, 0));
      return { title, rows, total };
    };

    const fixedAssets = buildSection('Fixed Assets', ['FIXED_ASSET']);
    const intangibleAssets = buildSection('Intangible Assets', ['INTANGIBLE_ASSET']);
    const currentAssets = buildSection('Current Assets', ['CURRENT_ASSET']);
    // Closing stock is reported on the BS as a current asset even when it
    // doesn't have its own ledger account yet.
    if (closingStock > 0) {
      currentAssets.rows.push({ code: '__CSTOCK', name: 'CLOSING STOCK (this period)', balance: closingStock });
      currentAssets.total = ROUND(currentAssets.total + closingStock);
    }

    const currentLiabilities = buildSection('Current Liabilities', ['CURRENT_LIABILITY', 'TAX_LIABILITY']);
    const longTermLiabilities = buildSection('Long-term Liabilities', ['MEDIUM_TERM_LIABILITY', 'LONG_TERM_LIABILITY']);
    const equityBase = buildSection('Equity', ['SHARE_CAPITAL', 'RETAINED_PROFIT', 'CAPITAL_RESERVE', 'DIVIDEND', 'DEPRECIATION_PROVISION']);
    equityBase.rows.push({ code: '__NPP', name: 'NET PROFIT (this period)', balance: netProfitInPeriod });
    equityBase.total = ROUND(equityBase.total + netProfitInPeriod);

    const totalAssets = ROUND(fixedAssets.total + intangibleAssets.total + currentAssets.total);
    const totalLiabilities = ROUND(currentLiabilities.total + longTermLiabilities.total);
    const totalEquity = equityBase.total;

    return {
      asOfDate: asOfDate.toISOString(),
      closingStock,
      netProfitInPeriod,
      assets: {
        sections: [fixedAssets, intangibleAssets, currentAssets],
        total: totalAssets,
      },
      liabilities: {
        sections: [currentLiabilities, longTermLiabilities],
        total: totalLiabilities,
      },
      equity: equityBase,
      totals: {
        totalAssets,
        totalLiabilitiesAndEquity: ROUND(totalLiabilities + totalEquity),
        balanced: ROUND(totalAssets - (totalLiabilities + totalEquity)) === 0,
      },
    };
  }

  // ---------- GST Report ----------
  // Reads tax activity off the GST control account (default CL900). Output tax
  // sits on the credit side of the control account (Cr GST Payable when an
  // invoice is posted), input tax on the debit side. Pre-tax for each entry is
  // recovered as the entry's matching-side total minus its tax line.
  async gstReport(
    organizationId: string,
    opts?: { startDate?: Date; endDate?: Date; category?: string },
  ) {
    // Resolve the org's tax control account — fall back to seeded default CL900.
    const settings = await this.prisma.accountingSetting.findUnique({ where: { organizationId } });
    const taxCode =
      (settings?.controlAccounts as any)?.taxLiabilities ||
      'CL900';

    const taxAccount = await this.prisma.chartOfAccount.findFirst({
      where: { organizationId, code: taxCode },
    });

    const empty = {
      period: { from: opts?.startDate ?? null, to: opts?.endDate ?? null },
      taxRegistrationNumber: settings?.taxRegistrationNumber ?? null,
      taxRate: settings?.taxDefaultPercentage ?? 9,
      summary: {
        outputTaxDue: 0,
        inputTaxClaimed: 0,
        netGstPayable: 0,
        totalStandardRatedSupplies: 0,
        totalZeroRatedSupplies: 0,
        totalExemptedSupplies: 0,
        totalSupplies: 0,
        totalTaxablePurchases: 0,
        majorExporterScheme: 0,
        revenue: 0,
      },
      details: [] as any[],
    };

    if (!taxAccount) return empty;

    const dateWhere: any = {};
    if (opts?.startDate) dateWhere.gte = opts.startDate;
    if (opts?.endDate) dateWhere.lte = opts.endDate;

    // Pull every posted journal entry that has a line on the tax account.
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        organizationId,
        status: 'POSTED',
        ...(opts?.startDate || opts?.endDate ? { entryDate: dateWhere } : {}),
        lines: { some: { accountId: taxAccount.id } },
      },
      include: {
        lines: { include: { account: true } },
      },
      orderBy: { entryDate: 'asc' },
    });

    // Output entry types affect output tax (sales side).
    // Input entry types affect input tax (purchase side).
    const OUTPUT_TYPES = new Set(['INVOICE', 'CREDIT_NOTE']);
    const INPUT_TYPES = new Set(['BILL', 'PURCHASE', 'PURCHASE_ORDER', 'PURCHASE_RETURN', 'DEBIT_NOTE']);

    const details: Array<{
      journalEntryId: string;
      journalNumber: string;
      sourceDocumentId: string | null;
      date: Date;
      type: string;
      remarks: string;
      preTaxAmount: number;
      taxRate: number;
      taxAmount: number;
      category: string;
    }> = [];

    let outputTaxDue = 0;
    let inputTaxClaimed = 0;
    let totalStandard = 0;
    let totalZero = 0;
    let totalSupplies = 0;
    let totalPurchases = 0;

    for (const e of entries) {
      const taxLine = e.lines.find((l) => l.accountId === taxAccount.id);
      if (!taxLine) continue;

      // Direction: tax credit = output (collected from customer);
      //            tax debit  = input (paid to supplier, claimable).
      const taxAmount = ROUND(taxLine.credit - taxLine.debit);
      const isOutputDirection = taxAmount >= 0;
      const absTax = Math.abs(taxAmount);

      // Pre-tax = total of the matching side minus the tax line itself.
      // Output entries: net sits on credits, gross hits debits → preTax = totalCredit - taxCredit
      // Input  entries: net sits on debits,  gross hits credits → preTax = totalDebit  - taxDebit
      let preTax: number;
      if (OUTPUT_TYPES.has(e.type) || (isOutputDirection && !INPUT_TYPES.has(e.type))) {
        preTax = ROUND(e.totalCredit - taxLine.credit);
      } else {
        preTax = ROUND(e.totalDebit - taxLine.debit);
      }

      // Effective tax rate on this entry. If both sides are zero, treat as exempt.
      const rate = preTax > 0 ? ROUND((absTax / preTax) * 100) : 0;

      // Category buckets — match legacy 7-category model.
      let category: string;
      if (isOutputDirection) {
        if (absTax > 0) category = 'OUTPUT_STANDARD';
        else if (preTax > 0) category = 'OUTPUT_ZERO';
        else category = 'OUTPUT_EXEMPT';
      } else {
        if (absTax > 0) category = 'INPUT_STANDARD';
        else if (preTax > 0) category = 'INPUT_ZERO';
        else category = 'INPUT_EXEMPT';
      }

      // Apply optional category filter.
      if (opts?.category && opts.category !== category) continue;

      // Tally summary numbers.
      if (isOutputDirection) {
        outputTaxDue += absTax;
        if (absTax > 0) totalStandard += preTax;
        else if (preTax > 0) totalZero += preTax;
        totalSupplies += preTax;
      } else {
        inputTaxClaimed += absTax;
        totalPurchases += preTax;
      }

      details.push({
        journalEntryId: e.id,
        journalNumber: e.journalNumber,
        sourceDocumentId: e.sourceDocumentId ?? null,
        date: e.entryDate,
        type: e.type,
        remarks: e.description ?? e.reference ?? '',
        preTaxAmount: preTax,
        taxRate: rate,
        taxAmount: absTax,
        category,
      });
    }

    return {
      period: { from: opts?.startDate ?? null, to: opts?.endDate ?? null },
      taxRegistrationNumber: settings?.taxRegistrationNumber ?? null,
      taxRate: settings?.taxDefaultPercentage ?? 9,
      summary: {
        outputTaxDue: ROUND(outputTaxDue),
        inputTaxClaimed: ROUND(inputTaxClaimed),
        netGstPayable: ROUND(outputTaxDue - inputTaxClaimed),
        totalStandardRatedSupplies: ROUND(totalStandard),
        totalZeroRatedSupplies: ROUND(totalZero),
        totalExemptedSupplies: 0, // Reserved for explicit exempt flagging; we have no current source.
        totalSupplies: ROUND(totalSupplies),
        totalTaxablePurchases: ROUND(totalPurchases),
        majorExporterScheme: 0,
        revenue: ROUND(totalSupplies),
      },
      details,
    };
  }
}
