import { Module } from '@nestjs/common';
import { IngestionEmailController } from './ingestion-email.controller';
import { EmailConfigController } from './email-config.controller';
import { IngestionEmailService } from './ingestion-email.service';
import { PrismaService } from '../common/prisma.service';
import { CommonModule } from '../common/common.module';
import { BillsModule } from '../bills/bills.module';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentExtractionModule } from '../document-extraction/document-extraction.module';

@Module({
  // CommonModule → S3Service; the rest export the services we route into.
  imports: [CommonModule, BillsModule, DocumentsModule, DocumentExtractionModule],
  controllers: [IngestionEmailController, EmailConfigController],
  providers: [IngestionEmailService, PrismaService],
})
export class IngestionEmailModule {}
