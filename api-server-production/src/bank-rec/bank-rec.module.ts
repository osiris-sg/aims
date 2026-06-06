import { Module } from '@nestjs/common';
import { BankRecController } from './bank-rec.controller';
import { BankRecService } from './bank-rec.service';
import { JournalModule } from '../journal/journal.module';
import { PrismaService } from '../common/prisma.service';

@Module({
  imports: [JournalModule],
  controllers: [BankRecController],
  providers: [BankRecService, PrismaService],
  exports: [BankRecService],
})
export class BankRecModule {}
