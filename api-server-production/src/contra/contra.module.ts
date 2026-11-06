import { Module } from '@nestjs/common';
import { ContraController } from './contra.controller';
import { ContraService } from './contra.service';
import { PrismaService } from '../common/prisma.service';
import { JournalModule } from '../journal/journal.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { PaymentVouchersModule } from '../payment-vouchers/payment-vouchers.module';
import { PaymentsModule } from '../payments/payments.module';
import { BillsModule } from '../bills/bills.module';

@Module({
  imports: [JournalModule, ReceiptsModule, PaymentVouchersModule, PaymentsModule, BillsModule],
  controllers: [ContraController],
  providers: [ContraService, PrismaService],
  exports: [ContraService],
})
export class ContraModule {}
