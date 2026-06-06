import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { JournalService } from '../journal/journal.service';

// ---------------------------------------------------------------------------
// Fixed Assets register + depreciation engine.
//
// Methods supported:
//   - STRAIGHT_LINE: (cost - salvageValue) ÷ usefulLifeMonths per period.
//   - DECLINING_BALANCE: book_value × (decliningRate / 100 / 12) per period.
//     Annual rate divided by 12 for monthly posting.
//   - UNITS_OF_PRODUCTION: (cost - salvage) / totalUnits × unitsThisPeriod.
//     unitsPerPeriod is the user-entered "units consumed since last close".
//
// Depreciation is posted by the Close Wizard during Month-End. Each call to
// postPeriod creates one balanced JE: Dr Depreciation Expense / Cr Provision.
// Won't double-post — uses unique constraint on (fixedAssetId, year, month).
// ---------------------------------------------------------------------------

const ROUND = (n: number) => Math.round(n * 100) / 100;

export type Method = 'STRAIGHT_LINE' | 'DECLINING_BALANCE' | 'UNITS_OF_PRODUCTION';

@Injectable()
export class FixedAssetsService {
  private readonly logger = new Logger(FixedAssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
  ) {}

  // ---------- CRUD ----------

  list(organizationId: string, includeInactive = false) {
    return this.prisma.fixedAsset.findMany({
      where: { organizationId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { code: 'asc' },
      include: { entries: { orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }], take: 1 } },
    });
  }

  async findOne(organizationId: string, id: string) {
    const row = await this.prisma.fixedAsset.findFirst({
      where: { id, organizationId },
      include: { entries: { orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }] } },
    });
    if (!row) throw new NotFoundException('Fixed asset not found');
    return row;
  }

  async create(
    organizationId: string,
    userId: string | undefined,
    dto: {
      code?: string;
      name: string;
      description?: string;
      category?: string;
      cost: number;
      salvageValue?: number;
      inServiceDate: string;
      method?: Method;
      usefulLifeMonths?: number;
      decliningRate?: number;
      totalUnits?: number;
      unitsPerPeriod?: number;
      sourcePoId?: string;
    },
  ) {
    if (!dto.name?.trim()) throw new BadRequestException('Name is required');
    if (!(dto.cost > 0)) throw new BadRequestException('Cost must be > 0');
    const code = dto.code?.trim() || (await this.nextCode(organizationId));
    const method = dto.method ?? 'STRAIGHT_LINE';
    this.validateMethodFields(method, dto);
    return this.prisma.fixedAsset.create({
      data: {
        organizationId,
        createdBy: userId,
        code,
        name: dto.name.trim(),
        description: dto.description,
        category: dto.category,
        cost: dto.cost,
        salvageValue: dto.salvageValue ?? 0,
        inServiceDate: new Date(dto.inServiceDate),
        method,
        usefulLifeMonths: dto.usefulLifeMonths ?? null,
        decliningRate: dto.decliningRate ?? null,
        totalUnits: dto.totalUnits ?? null,
        unitsPerPeriod: dto.unitsPerPeriod ?? null,
        sourcePoId: dto.sourcePoId ?? null,
      },
    });
  }

  async update(organizationId: string, id: string, dto: Partial<any>) {
    await this.findOne(organizationId, id);
    if (dto.method) this.validateMethodFields(dto.method, dto);
    return this.prisma.fixedAsset.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.salvageValue !== undefined && { salvageValue: dto.salvageValue }),
        ...(dto.method !== undefined && { method: dto.method }),
        ...(dto.usefulLifeMonths !== undefined && { usefulLifeMonths: dto.usefulLifeMonths }),
        ...(dto.decliningRate !== undefined && { decliningRate: dto.decliningRate }),
        ...(dto.totalUnits !== undefined && { totalUnits: dto.totalUnits }),
        ...(dto.unitsPerPeriod !== undefined && { unitsPerPeriod: dto.unitsPerPeriod }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async dispose(organizationId: string, id: string, proceeds?: number, disposedAt?: string) {
    await this.findOne(organizationId, id);
    return this.prisma.fixedAsset.update({
      where: { id },
      data: {
        disposedAt: disposedAt ? new Date(disposedAt) : new Date(),
        disposalProceeds: proceeds ?? 0,
        isActive: false,
      },
    });
  }

  // ---------- Depreciation calc ----------

  // Compute the depreciation amount this period for one asset. Returns 0 if
  // the asset is fully depreciated, not yet in service, or missing required
  // method config.
  computePeriodDepreciation(asset: any, totalAccumulated: number, periodDate: Date): number {
    if (!asset.isActive || asset.disposedAt) return 0;
    if (new Date(asset.inServiceDate) > periodDate) return 0;

    const basis = asset.cost - (asset.salvageValue || 0);
    if (basis <= 0) return 0;
    const remainingDepreciable = Math.max(0, basis - totalAccumulated);
    if (remainingDepreciable <= 0) return 0;

    let amount = 0;
    switch (asset.method) {
      case 'STRAIGHT_LINE': {
        if (!asset.usefulLifeMonths || asset.usefulLifeMonths <= 0) return 0;
        amount = basis / asset.usefulLifeMonths;
        break;
      }
      case 'DECLINING_BALANCE': {
        if (!asset.decliningRate || asset.decliningRate <= 0) return 0;
        const bookValue = asset.cost - totalAccumulated;
        const monthlyRate = asset.decliningRate / 100 / 12;
        amount = bookValue * monthlyRate;
        break;
      }
      case 'UNITS_OF_PRODUCTION': {
        if (!asset.totalUnits || asset.totalUnits <= 0 || !asset.unitsPerPeriod || asset.unitsPerPeriod <= 0) return 0;
        amount = (basis / asset.totalUnits) * asset.unitsPerPeriod;
        break;
      }
    }
    // Cap so accumulated never exceeds depreciable basis.
    return ROUND(Math.min(amount, remainingDepreciable));
  }

  // Run depreciation for a single period (typically called by the Close Wizard).
  // Returns the JE id if anything was posted, null if no depreciable activity.
  async postPeriod(
    organizationId: string,
    periodDate: Date,
    userId?: string,
  ): Promise<{ posted: boolean; journalEntryId: string | null; entriesCreated: number; perAsset: any[] }> {
    const year = periodDate.getFullYear();
    const month = periodDate.getMonth() + 1;

    const assets = await this.prisma.fixedAsset.findMany({
      where: { organizationId, isActive: true },
      include: { entries: true },
    });

    // Resolve accounts. Per-asset overrides first, then settings, then defaults.
    const settings = await this.prisma.accountingSetting.findUnique({
      where: { organizationId },
      select: { controlAccounts: true },
    });
    const controls = (settings?.controlAccounts as any) || {};
    const defaultProvisionCode = controls.depreciationProvision || 'PD001';
    const defaultExpenseCode = controls.depreciationExpense || 'EX410';

    const lookupAccountById = async (id: string | null) =>
      id ? this.prisma.chartOfAccount.findFirst({ where: { id, organizationId }, select: { id: true } }) : null;
    const lookupAccountByCode = async (code: string) =>
      this.prisma.chartOfAccount.findFirst({ where: { organizationId, code, isActive: true }, select: { id: true } });

    const defaultProvision = await lookupAccountByCode(defaultProvisionCode);
    const defaultExpense = await lookupAccountByCode(defaultExpenseCode);

    if (!defaultProvision || !defaultExpense) {
      throw new BadRequestException(
        `Depreciation accounts not found (looked for ${defaultProvisionCode} / ${defaultExpenseCode}). Configure controlAccounts.{depreciationProvision,depreciationExpense} or create these accounts.`,
      );
    }

    type LinePlan = {
      assetId: string;
      assetCode: string;
      amount: number;
      provisionAccountId: string;
      expenseAccountId: string;
    };
    const plans: LinePlan[] = [];
    const perAssetSummary: any[] = [];

    for (const a of assets) {
      // Skip if we already posted depreciation for this asset in this period.
      const already = a.entries.find((e: any) => e.periodYear === year && e.periodMonth === month);
      if (already) {
        perAssetSummary.push({ assetId: a.id, code: a.code, amount: 0, skipped: 'already posted' });
        continue;
      }

      const totalAccum = a.entries.reduce((s: number, e: any) => s + e.amount, 0);
      const amount = this.computePeriodDepreciation(a, totalAccum, periodDate);
      if (amount <= 0) {
        perAssetSummary.push({ assetId: a.id, code: a.code, amount: 0, skipped: 'zero amount' });
        continue;
      }

      const provision =
        (await lookupAccountById(a.depreciationProvisionAccountId)) ?? defaultProvision;
      const expense = (await lookupAccountById(a.depreciationExpenseAccountId)) ?? defaultExpense;

      plans.push({
        assetId: a.id,
        assetCode: a.code,
        amount,
        provisionAccountId: provision.id,
        expenseAccountId: expense.id,
      });
      perAssetSummary.push({ assetId: a.id, code: a.code, amount });
    }

    if (plans.length === 0) {
      return { posted: false, journalEntryId: null, entriesCreated: 0, perAsset: perAssetSummary };
    }

    // Build one JE covering all assets: per-asset Dr Expense / Cr Provision.
    const lines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [];
    for (const p of plans) {
      lines.push({
        accountId: p.expenseAccountId,
        debit: p.amount,
        credit: 0,
        description: `Depreciation ${year}-${String(month).padStart(2, '0')} — ${p.assetCode}`,
      });
      lines.push({
        accountId: p.provisionAccountId,
        debit: 0,
        credit: p.amount,
        description: `Provision ${year}-${String(month).padStart(2, '0')} — ${p.assetCode}`,
      });
    }

    const entry = await this.journal.create(
      organizationId,
      {
        entryDate: periodDate.toISOString(),
        type: 'ADJUSTMENT',
        reference: `DEP-${year}-${String(month).padStart(2, '0')}`,
        description: `Depreciation for ${year}-${String(month).padStart(2, '0')}`,
        lines,
      },
      userId,
    );
    const posted = await this.journal.post(organizationId, entry.id, userId);

    // Log depreciation entries (one row per asset for this period).
    await this.prisma.$transaction(
      plans.map((p) =>
        this.prisma.depreciationEntry.create({
          data: {
            fixedAssetId: p.assetId,
            organizationId,
            periodYear: year,
            periodMonth: month,
            amount: p.amount,
            journalEntryId: posted.id,
          },
        }),
      ),
    );

    return {
      posted: true,
      journalEntryId: posted.id,
      entriesCreated: plans.length,
      perAsset: perAssetSummary,
    };
  }

  // ---------- helpers ----------

  private async nextCode(organizationId: string): Promise<string> {
    const last = await this.prisma.fixedAsset.findFirst({
      where: { organizationId, code: { startsWith: 'FA-' } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    let n = 1;
    if (last?.code) {
      const m = last.code.match(/^FA-(\d+)$/);
      if (m) n = parseInt(m[1], 10) + 1;
    }
    return `FA-${String(n).padStart(3, '0')}`;
  }

  private validateMethodFields(method: string, dto: any) {
    if (method === 'STRAIGHT_LINE' && !(dto.usefulLifeMonths > 0)) {
      throw new BadRequestException('STRAIGHT_LINE requires usefulLifeMonths > 0');
    }
    if (method === 'DECLINING_BALANCE' && !(dto.decliningRate > 0)) {
      throw new BadRequestException('DECLINING_BALANCE requires decliningRate (annual %, >0)');
    }
    if (method === 'UNITS_OF_PRODUCTION' && (!(dto.totalUnits > 0) || !(dto.unitsPerPeriod > 0))) {
      throw new BadRequestException('UNITS_OF_PRODUCTION requires totalUnits > 0 and unitsPerPeriod > 0');
    }
  }
}
