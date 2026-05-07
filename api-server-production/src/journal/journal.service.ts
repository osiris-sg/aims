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
}
