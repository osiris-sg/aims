import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AccountingModule } from '../accounting/accounting.module';
import { PostingPreviewController } from './posting-preview.controller';
import { PostingPreviewService } from './posting-preview.service';

@Module({
  imports: [AccountingModule],
  controllers: [PostingPreviewController],
  providers: [PostingPreviewService, PrismaService],
  exports: [PostingPreviewService],
})
export class PostingPreviewModule {}
