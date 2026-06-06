import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { JournalService } from '../journal/journal.service';

const ROUND = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
  ) {}

  // Return the budget grid for one year — every account row × 12 month columns.
  // Front-end edits this grid, hits bulk-upsert to save.
  async getYear(organizationId: string, year: number) {
    const [accounts, budgets] = await Promise.all([
      this.prisma.chartOfAccount.findMany({
        where: { organizationId, isActive: true, category: 'PNL' },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true, accountType: true, normalBalance: true },
      }),
      this.prisma.budget.findMany({
        where: { organizationId, year },
        select: { accountId: true, month: true, amount: true },
      }),
    ]);

    // Build a map { accountId → { 1: amount, 2: amount, ... } }
    const byAccount = new Map<string, Record<number, number>>();
    for (const b of budgets) {
      const row = byAccount.get(b.accountId) ?? {};
      row[b.month] = b.amount;
      byAccount.set(b.accountId, row);
    }

    return {
      year,
      accounts: accounts.map((a) => ({
        ...a,
        budgets: byAccount.get(a.id) ?? {},
      })),
    };
  }

  // Bulk upsert — accepts { accountId, year, month, amount } rows. Amount=0
  // deletes the row (keeps the table small).
  async bulkUpsert(
    organizationId: string,
    items: Array<{ accountId: string; year: number; month: number; amount: number }>,
  ) {
    if (items.length === 0) return { upserted: 0 };

    const accountIds = Array.from(new Set(items.map((i) => i.accountId)));
    const owned = await this.prisma.chartOfAccount.findMany({
      where: { id: { in: accountIds }, organizationId },
      select: { id: true },
    });
    const ownedSet = new Set(owned.map((a) => a.id));

    const valid = items.filter((i) => ownedSet.has(i.accountId));

    await this.prisma.$transaction(
      valid.map((i) => {
        if (i.amount === 0 || Number.isNaN(i.amount)) {
          return this.prisma.budget.deleteMany({
            where: { accountId: i.accountId, year: i.year, month: i.month },
          });
        }
        return this.prisma.budget.upsert({
          where: { accountId_year_month: { accountId: i.accountId, year: i.year, month: i.month } },
          update: { amount: i.amount },
          create: { organizationId, accountId: i.accountId, year: i.year, month: i.month, amount: i.amount },
        });
      }),
    );

    return { upserted: valid.length };
  }

  // Copy budgets from one year to another. Useful for "start next year from
  // last year's numbers + my edits".
  async copyYear(organizationId: string, fromYear: number, toYear: number, overwrite = false) {
    const source = await this.prisma.budget.findMany({
      where: { organizationId, year: fromYear },
    });
    if (source.length === 0) return { copied: 0 };

    if (overwrite) {
      await this.prisma.budget.deleteMany({ where: { organizationId, year: toYear } });
    }
    await this.prisma.$transaction(
      source.map((b) =>
        this.prisma.budget.upsert({
          where: { accountId_year_month: { accountId: b.accountId, year: toYear, month: b.month } },
          update: { amount: b.amount },
          create: { organizationId, accountId: b.accountId, year: toYear, month: b.month, amount: b.amount },
        }),
      ),
    );
    return { copied: source.length };
  }

  // Budget vs Actual report for one year. Builds month-by-month actuals from
  // the journal (P&L category accounts) and compares to the stored budget.
  async report(organizationId: string, year: number) {
    const grid = await this.getYear(organizationId, year);

    // Compute YTD actuals per account by summing journal entry lines (month-by-month).
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 0, 23, 59, 59, 999);
    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        journalEntry: {
          organizationId,
          status: 'POSTED',
          entryDate: { gte: yearStart, lte: yearEnd },
        },
      },
      include: {
        journalEntry: { select: { entryDate: true } },
        account: { select: { id: true, normalBalance: true, category: true } },
      },
    });

    // actuals[accountId][month] = balance
    const actuals = new Map<string, Record<number, number>>();
    for (const l of lines) {
      if (l.account.category !== 'PNL') continue;
      const month = l.journalEntry.entryDate.getMonth() + 1;
      const delta = l.account.normalBalance === 'DEBIT' ? l.debit - l.credit : l.credit - l.debit;
      const row = actuals.get(l.account.id) ?? {};
      row[month] = ROUND((row[month] ?? 0) + delta);
      actuals.set(l.account.id, row);
    }

    return {
      year,
      rows: grid.accounts.map((a) => {
        const actualRow = actuals.get(a.id) ?? {};
        const months = Array.from({ length: 12 }, (_, i) => {
          const m = i + 1;
          const budget = a.budgets[m] ?? 0;
          const actual = actualRow[m] ?? 0;
          return {
            month: m,
            budget,
            actual: ROUND(actual),
            variance: ROUND(actual - budget),
            variancePct: budget !== 0 ? ROUND(((actual - budget) / Math.abs(budget)) * 100) : null,
          };
        });
        const totalBudget = months.reduce((s, m) => s + m.budget, 0);
        const totalActual = months.reduce((s, m) => s + m.actual, 0);
        return {
          accountId: a.id,
          code: a.code,
          name: a.name,
          accountType: a.accountType,
          months,
          totalBudget: ROUND(totalBudget),
          totalActual: ROUND(totalActual),
          totalVariance: ROUND(totalActual - totalBudget),
          totalVariancePct: totalBudget !== 0 ? ROUND(((totalActual - totalBudget) / Math.abs(totalBudget)) * 100) : null,
        };
      }),
    };
  }
}
