import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { JournalService } from '../journal/journal.service';

// ---------------------------------------------------------------------------
// Recurring Journal Templates — user-defined JEs that auto-create DRAFT
// entries on a schedule. Trigger is lazy: the Finance Hub calls runDue() on
// every load and creates drafts for any active template whose nextRunDate has
// passed (and isn't beyond endDate).
//
// Drafts only — never auto-post. The user reviews + posts via Audit Trail.
// ---------------------------------------------------------------------------

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

type RecurringLine = {
  accountId: string;
  description?: string;
  debit: number;
  credit: number;
};

const FREQUENCIES: Frequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'];

function advanceDate(d: Date, freq: Frequency): Date {
  const next = new Date(d);
  switch (freq) {
    case 'DAILY':
      next.setDate(next.getDate() + 1);
      break;
    case 'WEEKLY':
      next.setDate(next.getDate() + 7);
      break;
    case 'MONTHLY':
      next.setMonth(next.getMonth() + 1);
      break;
    case 'QUARTERLY':
      next.setMonth(next.getMonth() + 3);
      break;
    case 'YEARLY':
      next.setFullYear(next.getFullYear() + 1);
      break;
  }
  return next;
}

@Injectable()
export class RecurringService {
  private readonly logger = new Logger(RecurringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
  ) {}

  async list(organizationId: string) {
    return this.prisma.recurringJournalTemplate.findMany({
      where: { organizationId },
      orderBy: [{ isActive: 'desc' }, { nextRunDate: 'asc' }],
    });
  }

  async findOne(organizationId: string, id: string) {
    const row = await this.prisma.recurringJournalTemplate.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundException('Template not found');
    return row;
  }

  async create(
    organizationId: string,
    userId: string | undefined,
    dto: {
      name: string;
      description?: string;
      reference?: string;
      frequency: Frequency;
      nextRunDate: string;
      lines: RecurringLine[];
      endDate?: string;
    },
  ) {
    this.validate(dto);
    return this.prisma.recurringJournalTemplate.create({
      data: {
        organizationId,
        createdBy: userId,
        name: dto.name,
        description: dto.description,
        reference: dto.reference,
        frequency: dto.frequency,
        nextRunDate: new Date(dto.nextRunDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        lines: dto.lines as any,
        isActive: true,
      },
    });
  }

  async update(
    organizationId: string,
    id: string,
    dto: Partial<{
      name: string;
      description: string;
      reference: string;
      frequency: Frequency;
      nextRunDate: string;
      lines: RecurringLine[];
      endDate: string | null;
      isActive: boolean;
    }>,
  ) {
    const existing = await this.findOne(organizationId, id);
    if (dto.lines || dto.frequency) {
      this.validate({
        ...existing,
        ...dto,
        lines: dto.lines ?? (existing.lines as any),
        frequency: (dto.frequency ?? existing.frequency) as Frequency,
        nextRunDate: dto.nextRunDate ?? existing.nextRunDate.toISOString(),
      } as any);
    }
    return this.prisma.recurringJournalTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.reference !== undefined && { reference: dto.reference }),
        ...(dto.frequency !== undefined && { frequency: dto.frequency }),
        ...(dto.nextRunDate !== undefined && { nextRunDate: new Date(dto.nextRunDate) }),
        ...(dto.lines !== undefined && { lines: dto.lines as any }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : null }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    return this.prisma.recurringJournalTemplate.delete({ where: { id } });
  }

  // Run all templates that are active + due. Called by the hub on load and by
  // the manual "Run now" admin button. Creates DRAFT entries, advances
  // nextRunDate. Returns a summary of what ran.
  async runDue(organizationId: string, userId?: string, now: Date = new Date()) {
    const due = await this.prisma.recurringJournalTemplate.findMany({
      where: {
        organizationId,
        isActive: true,
        nextRunDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
    });

    const created: Array<{ templateId: string; entryId: string; journalNumber: string }> = [];
    const failed: Array<{ templateId: string; error: string }> = [];

    for (const tmpl of due) {
      try {
        const entry = await this.journal.create(
          organizationId,
          {
            entryDate: now.toISOString(),
            type: 'MANUAL',
            reference: tmpl.reference ?? undefined,
            description: `Recurring: ${tmpl.name}`,
            lines: tmpl.lines as any,
          },
          userId,
        );
        await this.prisma.recurringJournalTemplate.update({
          where: { id: tmpl.id },
          data: {
            lastRunAt: now,
            lastRunEntryId: entry.id,
            nextRunDate: advanceDate(tmpl.nextRunDate, tmpl.frequency as Frequency),
          },
        });
        created.push({ templateId: tmpl.id, entryId: entry.id, journalNumber: entry.journalNumber });
      } catch (e: any) {
        this.logger.warn(`[runDue] template ${tmpl.id} failed: ${e?.message || e}`);
        failed.push({ templateId: tmpl.id, error: e?.message || 'unknown' });
      }
    }

    return { ranAt: now.toISOString(), created, failed, dueCount: due.length };
  }

  // Run a single template on demand (admin "Run now" button on the row).
  async runOne(organizationId: string, id: string, userId?: string) {
    const tmpl = await this.findOne(organizationId, id);
    const now = new Date();
    const entry = await this.journal.create(
      organizationId,
      {
        entryDate: now.toISOString(),
        type: 'MANUAL',
        reference: tmpl.reference ?? undefined,
        description: `Recurring: ${tmpl.name}`,
        lines: tmpl.lines as any,
      },
      userId,
    );
    await this.prisma.recurringJournalTemplate.update({
      where: { id: tmpl.id },
      data: {
        lastRunAt: now,
        lastRunEntryId: entry.id,
        nextRunDate: advanceDate(tmpl.nextRunDate, tmpl.frequency as Frequency),
      },
    });
    return { templateId: tmpl.id, entryId: entry.id, journalNumber: entry.journalNumber };
  }

  private validate(dto: { frequency: string; lines: RecurringLine[]; name?: string }) {
    if (!FREQUENCIES.includes(dto.frequency as Frequency)) {
      throw new BadRequestException(`Invalid frequency: ${dto.frequency}`);
    }
    if (!dto.lines || dto.lines.length < 2) {
      throw new BadRequestException('Template needs at least 2 lines');
    }
    let totalDebit = 0;
    let totalCredit = 0;
    for (const l of dto.lines) {
      const d = Number(l.debit) || 0;
      const c = Number(l.credit) || 0;
      if (d < 0 || c < 0) throw new BadRequestException('Line amounts must be non-negative');
      if (d > 0 && c > 0) throw new BadRequestException('A line cannot have both debit and credit');
      totalDebit += d;
      totalCredit += c;
    }
    if (Math.round((totalDebit - totalCredit) * 100) !== 0) {
      throw new BadRequestException(`Template is unbalanced: debit ${totalDebit} vs credit ${totalCredit}`);
    }
  }
}
