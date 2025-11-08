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
import { PrismaService } from './common/prisma.service';
import { DocumentTemplatesModule } from './documentTemplates/documentTemplates.module';
import { UploadsModule } from './uploads/uploads.module';
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
