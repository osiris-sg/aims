import { Module } from '@nestjs/common';
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
import { OperatorController } from './operator.controller';
import { OperatorService } from './operator.service';
import { OperatorAuthService } from './operator-auth.service';
import { OperatorToolsService } from './operator-tools.service';
import { TelegramAdapter } from './adapters/telegram.adapter';

/**
 * AIMS Operator — a chat agent (Telegram first, WhatsApp later) that executes
 * real AIMS actions via a Claude tool-use loop. Reuses the existing services
 * rather than reimplementing any business logic; org scoping and permissions
 * come from the user the chat sender is linked to.
 */
@Module({
  imports: [
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
  ],
  controllers: [OperatorController],
  providers: [OperatorService, OperatorAuthService, OperatorToolsService, TelegramAdapter, PrismaService],
  exports: [OperatorService, OperatorAuthService],
})
export class OperatorModule {}
