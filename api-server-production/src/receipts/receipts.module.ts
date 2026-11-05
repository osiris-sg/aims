import { Module } from '@nestjs/common';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { PrismaService } from '../common/prisma.service';
import { JournalModule } from '../journal/journal.module';
import { PaymentsModule } from '../payments/payments.module';
import { AuditService } from 'src/common/audit.service';
import { DocumentNumberingModule } from '../document-numbering/document-numbering.module';

@Module({
  imports: [JournalModule, PaymentsModule, DocumentNumberingModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService, PrismaService, AuditService],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}
