import { Module } from '@nestjs/common';
import { IngestionEmailController } from './ingestion-email.controller';
import { EmailConfigController } from './email-config.controller';
import { EmailIntakeController } from './email-intake.controller';
import { EmailInboxController } from './email-inbox.controller';
import { EmailTriageService } from './email-triage.service';
import { ShipmentsModule } from '../shipments/shipments.module';
import { IngestionEmailService } from './ingestion-email.service';
import { PrismaService } from '../common/prisma.service';
import { CommonModule } from '../common/common.module';
import { BillsModule } from '../bills/bills.module';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentExtractionModule } from '../document-extraction/document-extraction.module';
import { LeadsModule } from '../leads/leads.module';

@Module({
  // CommonModule → S3Service; the rest export the services we route into.
  imports: [CommonModule, BillsModule, DocumentsModule, DocumentExtractionModule, LeadsModule, ShipmentsModule],
  controllers: [IngestionEmailController, EmailConfigController, EmailIntakeController, EmailInboxController],
  providers: [IngestionEmailService, EmailTriageService, PrismaService],
})
export class IngestionEmailModule {}
