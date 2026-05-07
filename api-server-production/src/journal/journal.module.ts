import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';
import { JournalAutoPostService } from './journal-auto-post.service';

@Module({
  controllers: [JournalController],
  providers: [JournalService, JournalAutoPostService, PrismaService],
  exports: [JournalService, JournalAutoPostService],
})
export class JournalModule {}
