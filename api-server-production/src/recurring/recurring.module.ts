import { Module } from '@nestjs/common';
import { RecurringController } from './recurring.controller';
import { RecurringService } from './recurring.service';
import { JournalModule } from '../journal/journal.module';
import { PrismaService } from '../common/prisma.service';

@Module({
  imports: [JournalModule],
  controllers: [RecurringController],
  providers: [RecurringService, PrismaService],
  exports: [RecurringService],
})
export class RecurringModule {}
