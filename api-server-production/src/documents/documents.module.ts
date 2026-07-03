import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { PrismaService } from 'src/common/prisma.service';
import { CommonModule } from 'src/common/common.module';
import { PriceHistoryModule } from '../price-history/price-history.module';
import { EmailModule } from '../email/email.module';
import { JournalModule } from '../journal/journal.module';
import { OrdersModule } from '../orders/orders.module';
import { DocumentTemplatesModule } from '../documentTemplates/documentTemplates.module';

@Module({
  imports: [CommonModule, PriceHistoryModule, EmailModule, JournalModule, OrdersModule, DocumentTemplatesModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, PrismaService],
  // Exported so MaintenanceReportsModule can call createBasicDocument when
  // an MSR with paymentRequired=true spins off an Invoice from the office.
  exports: [DocumentsService],
})
export class DocumentsModule {}
