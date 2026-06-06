import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';
import { JournalAutoPostService } from './journal-auto-post.service';
import { AnomaliesModule } from '../anomalies/anomalies.module';

@Module({
  imports: [AnomaliesModule],
  controllers: [JournalController],
  providers: [JournalService, JournalAutoPostService, PrismaService],
  exports: [JournalService, JournalAutoPostService],
})
export class JournalModule {}
