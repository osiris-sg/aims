import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { DocumentExtractionModule } from '../document-extraction/document-extraction.module';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentTemplatesModule } from '../documentTemplates/documentTemplates.module';
import { PrismaService } from '../common/prisma.service';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';
import { TradeConfigController } from './trade-config.controller';
import { TradeConfigService } from './trade-config.service';
import { TradeDocumentsController } from './trade-documents.controller';
import { TradeDocumentsService } from './trade-documents.service';
import { TradeGeneratedController, TradeHubController } from './trade-generated.controller';
import { TradeGeneratedService } from './trade-generated.service';
import { TradeHubService } from './trade-hub.service';
import { TradeExtractController } from './trade-extract.controller';
import { TradeExtractService } from './trade-extract.service';
import { TradeFilesController } from './trade-files.controller';
import { TradeFilesService } from './trade-files.service';
import { TradeStepsController } from './trade-steps.controller';
import { TradeStepsService } from './trade-steps.service';

/**
 * Shipments (ADH Japan, 2026-10): Contract → Shipment trade tracking with
 * per-org step templates, typed file uploads and links to in-app invoices
 * (TradeDocumentLink), in-app generated documents (Customer PL / COA from the
 * supplier spreadsheets) and the trade Documents hub. Gated per org by the
 * SHIPMENTS module and the shipments:* permissions. PIs and B/L drafts can be
 * read by AI (TradeExtractService, via the shared DocumentExtractionService).
 */
@Module({
  imports: [CommonModule, DocumentExtractionModule, DocumentsModule, DocumentTemplatesModule],
  controllers: [
    ContractsController,
    ShipmentsController,
    TradeStepsController,
    TradeFilesController,
    TradeConfigController,
    TradeDocumentsController,
    TradeGeneratedController,
    TradeHubController,
    TradeExtractController,
  ],
  providers: [
    ContractsService,
    ShipmentsService,
    TradeStepsService,
    TradeFilesService,
    TradeConfigService,
    TradeDocumentsService,
    TradeGeneratedService,
    TradeHubService,
    TradeExtractService,
    PrismaService,
  ],
  exports: [ContractsService, ShipmentsService, TradeStepsService, TradeFilesService, TradeConfigService, TradeDocumentsService],
})
export class ShipmentsModule {}
