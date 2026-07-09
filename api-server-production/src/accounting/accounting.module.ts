import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ChartOfAccountsController } from './chart-of-accounts.controller';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { AccountingSettingsController } from './accounting-settings.controller';
import { AccountingSettingsService } from './accounting-settings.service';
import { InventoryValuationController } from './inventory-valuation.controller';
import { InventoryValuationService } from './inventory-valuation.service';
import { TaxRatesController } from './tax-rates.controller';
import { TaxRatesService } from './tax-rates.service';

@Module({
  controllers: [ChartOfAccountsController, AccountingSettingsController, InventoryValuationController, TaxRatesController],
  providers: [ChartOfAccountsService, AccountingSettingsService, InventoryValuationService, TaxRatesService, PrismaService],
  exports: [ChartOfAccountsService, AccountingSettingsService, InventoryValuationService, TaxRatesService],
})
export class AccountingModule {}
