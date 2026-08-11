import { Module } from '@nestjs/common';
import { SubmitController } from './submit.controller';
import { SubmitService } from './submit.service';
import { PrismaService } from '../common/prisma.service';
import { CommonModule } from '../common/common.module';
import { BillsModule } from '../bills/bills.module';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentExtractionModule } from '../document-extraction/document-extraction.module';

@Module({
  // CommonModule → S3Service; the rest export the services the worker routes into.
  imports: [CommonModule, BillsModule, DocumentsModule, DocumentExtractionModule],
  controllers: [SubmitController],
  providers: [SubmitService, PrismaService],
})
export class SubmitModule {}
