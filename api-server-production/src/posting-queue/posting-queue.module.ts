import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { JournalModule } from '../journal/journal.module';
import { PostingPreviewModule } from '../posting-preview/posting-preview.module';
import { PostingQueueController } from './posting-queue.controller';
import { PostingQueueService } from './posting-queue.service';

@Module({
  imports: [JournalModule, PostingPreviewModule],
  controllers: [PostingQueueController],
  providers: [PostingQueueService, PrismaService],
  exports: [PostingQueueService],
})
export class PostingQueueModule {}
