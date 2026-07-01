import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import configuration from '../config/configuration';
import { AssetsModule } from './assets/assets.module';
import { CategoriesModule } from './categories/categories.module';
import { ClerkClientProvider } from './providers/clerk-client.provider';
import { AuthModule } from './auth/auth.module';
import { APP_GUARD } from '@nestjs/core';
import { ClerkAuthGuard } from './auth/clerk-auth.guard';
import { InventoriesModule } from './inventories/inventories.module';
import { CustomersModule } from './customers/customers.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PrismaService } from './common/prisma.service';
import { DocumentTemplatesModule } from './documentTemplates/documentTemplates.module';
import { UploadsModule } from './uploads/uploads.module';
import { PublicDeliveryModule } from './public-delivery/public-delivery.module';
import { DocumentsModule } from './documents/documents.module';
import { TimelineItemsModule } from './timeline-items/timeline-items.module';
import { RolesModule } from './roles/roles.module';
import { PermissionsModule } from './permissions/permissions.module';
import { UsersModule } from './users/users.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ProjectsModule } from './projects/projects.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { AdminModule } from './admin/admin.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DocumentExtractionModule } from './document-extraction/document-extraction.module';
import { ConfigurationModule } from './configuration/configuration.module';
import { PriceHistoryModule } from './price-history/price-history.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { TransactionsModule } from './transactions/transactions.module';
import { StatementsModule } from './statements/statements.module';
import { EmailModule } from './email/email.module';
import { ImportModule } from './import/import.module';
import { AccountingModule } from './accounting/accounting.module';
import { JournalModule } from './journal/journal.module';
import { MaintenanceReportsModule } from './maintenance-reports/maintenance-reports.module';
import { AskModule } from './ask/ask.module';
import { AnomaliesModule } from './anomalies/anomalies.module';
import { CloseModule } from './close/close.module';
import { RecurringModule } from './recurring/recurring.module';
import { CostCentersModule } from './cost-centers/cost-centers.module';
import { FixedAssetsModule } from './fixed-assets/fixed-assets.module';
import { BudgetsModule } from './budgets/budgets.module';
import { BillsModule } from './bills/bills.module';
import { PostingPreviewModule } from './posting-preview/posting-preview.module';
import { BankRecModule } from './bank-rec/bank-rec.module';
import { XeroSyncModule } from './xero-sync/xero-sync.module';
import { DocumentAssistantModule } from './document-assistant/document-assistant.module';
import { IngestionModule } from './ingestion/ingestion.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
    }),
    AssetsModule,
    CategoriesModule,
    AuthModule,
    InventoriesModule,
    CustomersModule,
    SuppliersModule,
    DocumentTemplatesModule,
    UploadsModule,
    DocumentsModule,
    TimelineItemsModule,
    RolesModule,
    PermissionsModule,
    UsersModule,
    ProjectsModule,
    OrganizationsModule,
    AdminModule,
    DashboardModule,
    DocumentExtractionModule,
    ConfigurationModule,
    PriceHistoryModule,
    OrdersModule,
    PaymentsModule,
    TransactionsModule,
    StatementsModule,
    EmailModule,
    ImportModule,
    AccountingModule,
    JournalModule,
    MaintenanceReportsModule,
    AskModule,
    DocumentAssistantModule,
    AnomaliesModule,
    CloseModule,
    RecurringModule,
    CostCentersModule,
    FixedAssetsModule,
    BudgetsModule,
    BillsModule,
    PostingPreviewModule,
    BankRecModule,
    XeroSyncModule,
    PublicDeliveryModule,
    IngestionModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    ClerkClientProvider,
    PrismaService,
    {
      provide: APP_GUARD,
      useClass: ClerkAuthGuard,
    },
  ],
})
export class AppModule {
  constructor() {}

  static registerSwagger(app) {
    const config = new DocumentBuilder()
      .setTitle('Your API Title')
      .setDescription('Your API Description')
      .setVersion('1.0')
      // .addTag('cats') // You can add tags to group your endpoints
      // .addBearerAuth() // For Bearer token authentication
      // .addOAuth2()    // For OAuth2 authentication
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document); // 'api' is the path where Swagger UI will be available
  }

  async onModuleInit() {
    // You can call registerSwagger here or in your main.ts
  }
}
