import { Module } from '@nestjs/common';
import { AdvancesModule } from '../advances/advances.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { RevenueItemsModule } from '../revenue-items/revenue-items.module';
import { MarketingModule } from '../marketing/marketing.module';
import { LeadsModule } from '../leads/leads.module';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { PrismaService } from '../common/prisma.service';
import { CommonModule } from '../common/common.module';
import { CustomersModule } from '../customers/customers.module';
import { AssetsModule } from '../assets/assets.module';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentTemplatesModule } from '../documentTemplates/documentTemplates.module';
import { PriceHistoryModule } from '../price-history/price-history.module';
import { PaymentsModule } from '../payments/payments.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { StatementsModule } from '../statements/statements.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { BillsModule } from '../bills/bills.module';
import { InventoriesModule } from '../inventories/inventories.module';
import { ProjectsModule } from '../projects/projects.module';
import { ProjectCostingModule } from '../project-costing/project-costing.module';
import { OperatorController } from './operator.controller';
import { XeroSyncModule } from '../xero-sync/xero-sync.module';
import { BankRecModule } from '../bank-rec/bank-rec.module';
import { OperatorService } from './operator.service';
import { OperatorAuthService } from './operator-auth.service';
import { OperatorToolsService } from './operator-tools.service';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';

/**
 * AIMS Operator — a chat agent (Telegram first, WhatsApp later) that executes
 * real AIMS actions via a Claude tool-use loop. Reuses the existing services
 * rather than reimplementing any business logic; org scoping and permissions
 * come from the user the chat sender is linked to.
 */
import { PublicDocumentModule } from '../public-document/public-document.module';
import { AuthModule } from '../auth/auth.module'; // provides 'ClerkClient' for the act-as lookup
@Module({
  imports: [
    AdvancesModule,
    AppointmentsModule, // my_appointments / booking_link tools
    AuthModule, // 'ClerkClient' — names/emails for /as
    CommonModule, // AuditService
    CustomersModule,
    AssetsModule,
    DocumentsModule,
    DocumentTemplatesModule,
    PriceHistoryModule,
    PaymentsModule,
    ReceiptsModule,
    StatementsModule,
    SuppliersModule,
    BillsModule,
    InventoriesModule,
    ProjectsModule,
    ProjectCostingModule,
    RevenueItemsModule,
    MarketingModule,
    LeadsModule,
    DeliveriesModule, // schedule_delivery tool → real delivery runs
    PublicDocumentModule, // preview_document → view-only DO link
    XeroSyncModule, // confirm_invoices_from_xero tool
    BankRecModule, // bank_rec_checkpoint tool
  ],
  controllers: [OperatorController],
  providers: [OperatorService, OperatorAuthService, OperatorToolsService, TelegramAdapter, WhatsAppAdapter, PrismaService],
  exports: [OperatorService, OperatorAuthService, WhatsAppAdapter],
})
export class OperatorModule {}
