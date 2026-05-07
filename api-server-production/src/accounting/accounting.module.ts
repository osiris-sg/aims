import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ChartOfAccountsController } from './chart-of-accounts.controller';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { AccountingSettingsController } from './accounting-settings.controller';
import { AccountingSettingsService } from './accounting-settings.service';

@Module({
  controllers: [ChartOfAccountsController, AccountingSettingsController],
  providers: [ChartOfAccountsService, AccountingSettingsService, PrismaService],
  exports: [ChartOfAccountsService, AccountingSettingsService],
})
export class AccountingModule {}
