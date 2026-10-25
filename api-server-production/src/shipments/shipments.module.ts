import { MonthlyListController } from './monthly-list.controller';
import { MonthlyListService } from './monthly-list.service';
import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { DocumentExtractionModule } from '../document-extraction/document-extraction.module';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentTemplatesModule } from '../documentTemplates/documentTemplates.module';
import { PrismaService } from '../common/prisma.service';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { ShipmentsNotifyService } from './shipments-notify.service';
import { TradeAdminDashboardService } from './trade-admin-dashboard.service';
import { SupplierOrdersController } from './supplier-orders.controller';
import { SupplierOrdersService } from './supplier-orders.service';
import { TradePriceCheckController } from './trade-price-check.controller';
import { TradePriceCheckService } from './trade-price-check.service';
import { TradePaymentsController } from './trade-payments.controller';
import { TradePaymentsService } from './trade-payments.service';
import { TradeAlertsController } from './trade-alerts.controller';
import { TradeAlertsService } from './trade-alerts.service';
import { LmeFeedService } from './lme-feed.service';
import { CarrierTrackingService } from './carrier-tracking.service';
import { CarrierTrackingController } from './carrier-tracking.controller';
import { TradeDashboardController } from './trade-dashboard.controller';
import { TradeDashboardService } from './trade-dashboard.service';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
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
import { TradeThumbsService } from './trade-thumbs.service';
import { TradeStepsController } from './trade-steps.controller';
import { TradeStepsService } from './trade-steps.service';

/**
 * Shipments (ADH Japan, 2026-10): Contract → Order ("#19") → Shipment ("#19-1") trade tracking with
 * per-org step templates, typed file uploads and links to in-app invoices
 * (TradeDocumentLink), in-app generated documents (Customer PL / COA from the
 * supplier spreadsheets) and the trade Documents hub. Gated per org by the
 * SHIPMENTS module and the shipments:* permissions. PIs and B/L drafts can be
 * read by AI (TradeExtractService, via the shared DocumentExtractionService).
 */
@Module({
  imports: [CommonModule, DocumentExtractionModule, DocumentsModule, DocumentTemplatesModule, EmailModule, NotificationsModule],
  controllers: [
    CarrierTrackingController,
    MonthlyListController,
    OrdersController,
    SupplierOrdersController,
    TradePriceCheckController,
    TradePaymentsController,
    TradeAlertsController,
    TradeDashboardController,
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
    MonthlyListService,
    ShipmentsNotifyService, // round S: WhatsApp staff notification queue
    OrdersService,
    SupplierOrdersService,
    TradePriceCheckService,
    TradePaymentsService,
    TradeAlertsService,
    LmeFeedService,
    CarrierTrackingService,
    TradeDashboardService,
    TradeAdminDashboardService, // round T: the Admin dashboard
    ContractsService,
    ShipmentsService,
    TradeStepsService,
    TradeFilesService,
    TradeThumbsService,
    TradeConfigService,
    TradeDocumentsService,
    TradeGeneratedService,
    TradeHubService,
    TradeExtractService,
    PrismaService,
  ],
  exports: [CarrierTrackingService, MonthlyListService, ShipmentsNotifyService, TradeAdminDashboardService, TradeGeneratedService, OrdersService, SupplierOrdersService, TradeAlertsService, ContractsService, ShipmentsService, TradeStepsService, TradeFilesService, TradeConfigService, TradeDocumentsService, TradeExtractService],
})
export class ShipmentsModule {}
