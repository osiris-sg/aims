import { Module } from '@nestjs/common';
import { PaymentVouchersController } from './payment-vouchers.controller';
import { PaymentVouchersService } from './payment-vouchers.service';
import { PrismaService } from '../common/prisma.service';
import { JournalModule } from '../journal/journal.module';
import { BillsModule } from '../bills/bills.module';
import { AuditService } from 'src/common/audit.service';
import { DocumentNumberingModule } from '../document-numbering/document-numbering.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [JournalModule, BillsModule, DocumentNumberingModule, ReceiptsModule, PaymentsModule],
  controllers: [PaymentVouchersController],
  providers: [PaymentVouchersService, PrismaService, AuditService],
  exports: [PaymentVouchersService],
})
export class PaymentVouchersModule {}
