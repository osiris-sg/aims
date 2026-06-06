import { Module } from '@nestjs/common';
import { AskController } from './ask.controller';
import { AskService } from './ask.service';
import { JournalModule } from '../journal/journal.module';
import { AccountingModule } from '../accounting/accounting.module';
import { PrismaService } from '../common/prisma.service';

@Module({
  imports: [JournalModule, AccountingModule],
  controllers: [AskController],
  // ClerkAuthGuard (applied to AskController) depends on PrismaService — every
  // module that uses the guard needs its own PrismaService provider, mirroring
  // the pattern in JournalModule / AccountingModule.
  providers: [AskService, PrismaService],
})
export class AskModule {}
