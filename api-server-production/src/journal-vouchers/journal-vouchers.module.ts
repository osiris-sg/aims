import { Module } from '@nestjs/common';
import { JournalVouchersController } from './journal-vouchers.controller';
import { JournalVouchersService } from './journal-vouchers.service';
import { PrismaService } from '../common/prisma.service';
import { JournalModule } from '../journal/journal.module';
import { BillsModule } from '../bills/bills.module';
import { PaymentVouchersModule } from '../payment-vouchers/payment-vouchers.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { PaymentsModule } from '../payments/payments.module';
import { AuditService } from 'src/common/audit.service';

@Module({
  imports: [JournalModule, BillsModule, PaymentVouchersModule, ReceiptsModule, PaymentsModule],
  controllers: [JournalVouchersController],
  providers: [JournalVouchersService, PrismaService, AuditService],
  exports: [JournalVouchersService],
})
export class JournalVouchersModule {}
