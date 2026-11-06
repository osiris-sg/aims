import { Module } from '@nestjs/common';
import { BankTransactionsController } from './bank-transactions.controller';
import { BankTransactionsService } from './bank-transactions.service';
import { PrismaService } from '../common/prisma.service';
import { JournalModule } from '../journal/journal.module';
import { AuditService } from 'src/common/audit.service';
import { DocumentNumberingModule } from '../document-numbering/document-numbering.module';

@Module({
  imports: [JournalModule, DocumentNumberingModule],
  controllers: [BankTransactionsController],
  providers: [BankTransactionsService, PrismaService, AuditService],
  exports: [BankTransactionsService],
})
export class BankTransactionsModule {}
