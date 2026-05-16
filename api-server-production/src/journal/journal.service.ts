import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreateJournalEntryDto, JournalLineDto, UpdateJournalEntryDto } from './dto/journal-entry.dto';

const ROUND = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class JournalService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Numbering ----------

  private async nextJournalNumber(organizationId: string, prefix = 'JV'): Promise<string> {
    // Look up the highest existing journalNumber matching the prefix.
    const last = await this.prisma.journalEntry.findFirst({
      where: { organizationId, journalNumber: { startsWith: `${prefix}-` } },
      orderBy: { journalNumber: 'desc' },
      select: { journalNumber: true },
    });

    let nextSeq = 1;
    if (last?.journalNumber) {
      const tail = last.journalNumber.replace(`${prefix}-`, '');
      const n = parseInt(tail, 10);
      if (!Number.isNaN(n)) nextSeq = n + 1;
    }
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
    options?: { autoPost?: boolean },
  ) {
    const { totalDebit, totalCredit } = this.validateLines(dto.lines);
    await this.assertAccountsBelongToOrg(organizationId, dto.lines.map((l) => l.accountId));

    const journalNumber = dto.journalNumber || (await this.nextJournalNumber(organizationId));

    return this.prisma.$transaction(async (tx) => {
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
    const where: any = { organizationId, status: 'POSTED' };
    if (asOfDate) where.entryDate = { lte: asOfDate };

    const lines = await this.prisma.journalEntryLine.findMany({
      where: { journalEntry: where },
      include: { account: true },
    });

    type Row = {
      accountId: string;
      code: string;
      name: string;
      category: string;
      normalBalance: string;
      debit: number;
      credit: number;
      balance: number;
    };

    const byAccount = new Map<string, Row>();
    for (const l of lines) {
      const a = l.account;
      const existing = byAccount.get(a.id) ?? {
        accountId: a.id,
        code: a.code,
        name: a.name,
        category: a.category,
        normalBalance: a.normalBalance,
        debit: 0,
        credit: 0,
        balance: 0,
      };
      existing.debit += l.debit;
      existing.credit += l.credit;
      byAccount.set(a.id, existing);
    }

    const rows = Array.from(byAccount.values()).map((r) => {
      r.debit = ROUND(r.debit);
      r.credit = ROUND(r.credit);
      r.balance = ROUND(r.normalBalance === 'DEBIT' ? r.debit - r.credit : r.credit - r.debit);
      return r;
    });

    rows.sort((a, b) => a.code.localeCompare(b.code));

    const totalDebit = ROUND(rows.reduce((s, r) => s + r.debit, 0));
    const totalCredit = ROUND(rows.reduce((s, r) => s + r.credit, 0));

    return { asOfDate: asOfDate ?? null, rows, totalDebit, totalCredit, isBalanced: totalDebit === totalCredit };
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

  // ---------- P&L / Balance Sheet helpers ----------

  // Sum debits/credits per account between (startDate, endDate]. Used as the
  // building block for both P&L (period activity) and Balance Sheet (cumulative).
  private async accountActivity(
    organizationId: string,
    opts: { startDate?: Date; endDate?: Date },
  ) {
    const dateFilter: any = {};
    if (opts.startDate) dateFilter.gte = opts.startDate;
    if (opts.endDate) dateFilter.lte = opts.endDate;

    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        journalEntry: {
          organizationId,
          status: 'POSTED',
          ...(opts.startDate || opts.endDate ? { entryDate: dateFilter } : {}),
        },
      },
      include: { account: true },
    });

    const byAccount = new Map<
      string,
      { id: string; code: string; name: string; accountType: string; category: string; normalBalance: string; debit: number; credit: number }
    >();

    for (const l of lines) {
      const a = l.account;
      const e = byAccount.get(a.id) ?? {
        id: a.id,
        code: a.code,
        name: a.name,
        accountType: a.accountType,
        category: a.category,
        normalBalance: a.normalBalance,
        debit: 0,
        credit: 0,
      };
      e.debit += l.debit;
      e.credit += l.credit;
      byAccount.set(a.id, e);
    }

    return Array.from(byAccount.values()).map((r) => ({
      ...r,
      debit: ROUND(r.debit),
      credit: ROUND(r.credit),
      balance: ROUND(r.normalBalance === 'DEBIT' ? r.debit - r.credit : r.credit - r.debit),
    }));
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
