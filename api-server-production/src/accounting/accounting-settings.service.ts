import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { UpdateAccountingSettingsDto } from './dto/accounting-settings.dto';
import {
  DEFAULT_ACCOUNT_CODE_RANGES,
  DEFAULT_CONTROL_ACCOUNTS,
  DEFAULT_NEXT_NUMBERS,
} from './default-chart-of-accounts';

@Injectable()
export class AccountingSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(organizationId: string) {
    const existing = await this.prisma.accountingSetting.findUnique({ where: { organizationId } });
    if (existing) return existing;

    return this.prisma.accountingSetting.create({
      data: {
        organizationId,
        baseCurrency: 'SGD',
        nextNumbers: DEFAULT_NEXT_NUMBERS,
        numberPrefixes: {},
        activateLastSoldPrice: true,
        activateLastBuyPrice: true,
        taxDefaultPercentage: 9,
        taxReference: 'GST',
        accountCodeRanges: DEFAULT_ACCOUNT_CODE_RANGES,
        controlAccounts: DEFAULT_CONTROL_ACCOUNTS,
      },
    });
  }

  async update(organizationId: string, dto: UpdateAccountingSettingsDto) {
    // Ensure the row exists before updating.
    await this.getOrCreate(organizationId);

    const data: any = { ...dto };
    if (dto.yearOpeningDate) data.yearOpeningDate = new Date(dto.yearOpeningDate);
    if (dto.monthOpeningDate) data.monthOpeningDate = new Date(dto.monthOpeningDate);
    if (dto.lockedThroughDate !== undefined) {
      data.lockedThroughDate = dto.lockedThroughDate ? new Date(dto.lockedThroughDate) : null;
    }

    const updated = await this.prisma.accountingSetting.update({
      where: { organizationId },
      data,
    });

    // Keep the legacy Organization-level tax fields in sync so existing readers
    // (document editor, GST report) stay consistent — single source of truth is
    // now the Financial Settings tab, but both fields are written.
    const orgPatch: any = {};
    if (dto.taxDefaultPercentage !== undefined) orgPatch.taxRate = dto.taxDefaultPercentage;
    if (dto.salesTaxInclusive !== undefined) orgPatch.absorbTax = dto.salesTaxInclusive;
    if (Object.keys(orgPatch).length > 0) {
      await this.prisma.organization.update({ where: { id: organizationId }, data: orgPatch }).catch(() => {
        // non-fatal — settings still saved on AccountingSetting
      });
    }

    return updated;
  }
}
