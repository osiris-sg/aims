import { Module } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { DocumentsModule } from '../documents/documents.module';
import { QuotationTemplatesController } from './quotation-templates.controller';
import { QuotationTemplatesService } from './quotation-templates.service';

// Quotation templates (features.enableQuotationTemplates, WCT group). PrismaService
// is per-module in this app (not global), so it is listed here.
@Module({
  imports: [DocumentsModule],
  controllers: [QuotationTemplatesController],
  providers: [QuotationTemplatesService, PrismaService],
})
export class QuotationTemplatesModule {}
