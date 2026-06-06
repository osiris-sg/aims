import { Module } from '@nestjs/common';
import { BillsController } from './bills.controller';
import { BillsInboundController } from './bills-inbound.controller';
import { BillsService } from './bills.service';
import { JournalModule } from '../journal/journal.module';
import { PrismaService } from '../common/prisma.service';

@Module({
  imports: [JournalModule],
  controllers: [BillsController, BillsInboundController],
  providers: [BillsService, PrismaService],
  exports: [BillsService],
})
export class BillsModule {}
