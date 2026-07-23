import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CustomersModule } from '../customers/customers.module';
import { BillsModule } from '../bills/bills.module';
import { DocumentNumberingModule } from '../document-numbering/document-numbering.module';
import { JournalModule } from '../journal/journal.module';
import { PostingQueueModule } from '../posting-queue/posting-queue.module';
import { PostingPreviewModule } from '../posting-preview/posting-preview.module';
import { ApiV1KeyGuard } from './api-v1-key.guard';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysAdminController } from './api-keys.admin.controller';
import { V1DocumentsService } from './v1-documents.service';
import { V1DocumentsController } from './v1-documents.controller';

// External /v1 API (DB-backed per-org API keys) + admin key management.
// Distinct from PublicApiModule (water-sg's env-secret pull API).
@Module({
  imports: [CustomersModule, BillsModule, DocumentNumberingModule, JournalModule, PostingQueueModule, PostingPreviewModule],
  controllers: [V1DocumentsController, ApiKeysAdminController],
  providers: [V1DocumentsService, ApiKeysService, ApiV1KeyGuard, PrismaService],
})
export class ApiV1Module {}
