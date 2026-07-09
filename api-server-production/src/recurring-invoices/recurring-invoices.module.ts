import { Module } from '@nestjs/common';
import { RecurringInvoicesService } from './recurring-invoices.service';
import { RecurringInvoicesController } from './recurring-invoices.controller';
import { PrismaService } from '../common/prisma.service';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [DocumentsModule],
  controllers: [RecurringInvoicesController],
  providers: [RecurringInvoicesService, PrismaService],
  exports: [RecurringInvoicesService],
})
export class RecurringInvoicesModule {}
