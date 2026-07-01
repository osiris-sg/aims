import { Module } from '@nestjs/common';
import { BillsController } from './bills.controller';
import { BillsInboundController } from './bills-inbound.controller';
import { BillsService } from './bills.service';
import { JournalModule } from '../journal/journal.module';
import { AccountingModule } from '../accounting/accounting.module';
import { AccountMemoryModule } from '../account-memory/account-memory.module';
import { PrismaService } from '../common/prisma.service';

@Module({
  imports: [JournalModule, AccountingModule, AccountMemoryModule],
  controllers: [BillsController, BillsInboundController],
  providers: [BillsService, PrismaService],
  exports: [BillsService],
})
export class BillsModule {}
