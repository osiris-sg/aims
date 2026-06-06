import { Module } from '@nestjs/common';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { JournalModule } from '../journal/journal.module';
import { PrismaService } from '../common/prisma.service';

@Module({
  imports: [JournalModule],
  controllers: [BudgetsController],
  providers: [BudgetsService, PrismaService],
})
export class BudgetsModule {}
