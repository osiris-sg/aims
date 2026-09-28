import { Module } from '@nestjs/common';
import { BankRecController } from './bank-rec.controller';
import { BankRecService } from './bank-rec.service';
import { JournalModule } from '../journal/journal.module';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { PaymentsModule } from '../payments/payments.module';
import { BillsModule } from '../bills/bills.module';

@Module({
  imports: [JournalModule, PaymentsModule, BillsModule],
  controllers: [BankRecController],
  providers: [BankRecService, PrismaService, AuditService],
  exports: [BankRecService],
})
export class BankRecModule {}
