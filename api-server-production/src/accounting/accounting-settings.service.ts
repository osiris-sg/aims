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

    return this.prisma.accountingSetting.update({
      where: { organizationId },
      data,
    });
  }
}
