import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ChartOfAccountsController } from './chart-of-accounts.controller';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { AccountingSettingsController } from './accounting-settings.controller';
import { AccountingSettingsService } from './accounting-settings.service';
import { InventoryValuationController } from './inventory-valuation.controller';
import { InventoryValuationService } from './inventory-valuation.service';

@Module({
  controllers: [ChartOfAccountsController, AccountingSettingsController, InventoryValuationController],
  providers: [ChartOfAccountsService, AccountingSettingsService, InventoryValuationService, PrismaService],
  exports: [ChartOfAccountsService, AccountingSettingsService, InventoryValuationService],
})
export class AccountingModule {}
