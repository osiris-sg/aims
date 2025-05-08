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
export class AppModule {}
