import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { PrismaService } from 'src/common/prisma.service';
import { CommonModule } from 'src/common/common.module';
import { PriceHistoryModule } from '../price-history/price-history.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { EmailModule } from '../email/email.module';
import { JournalModule } from '../journal/journal.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [CommonModule, PriceHistoryModule, TransactionsModule, EmailModule, JournalModule, OrdersModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, PrismaService],
})
export class DocumentsModule {}
