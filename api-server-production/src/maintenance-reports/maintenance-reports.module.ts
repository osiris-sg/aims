import { Module } from '@nestjs/common';
import { CommonModule } from 'src/common/common.module';
import { PrismaService } from 'src/common/prisma.service';
import { EmailModule } from '../email/email.module';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentTemplatesModule } from '../documentTemplates/documentTemplates.module';
import { MaintenanceReportsController } from './maintenance-reports.controller';
import { MaintenanceReportsService } from './maintenance-reports.service';

@Module({
  // CommonModule exports PdfGeneratorService (puppeteer wrapper).
  // EmailModule exports EmailService (Resend client) for the auto-email path
  // when paymentRequired === false.
  // DocumentsModule exports DocumentsService.createBasicDocument used to spin
  // off an Invoice document from an MSR with paymentRequired === true.
  // DocumentTemplatesModule exports DocumentTemplatesService for the
  // field-accessible do-view aggregator (resolves variant + field config).
  imports: [CommonModule, EmailModule, DocumentsModule, DocumentTemplatesModule],
  controllers: [MaintenanceReportsController],
  providers: [MaintenanceReportsService, PrismaService],
  // Exported so PublicDeliveryModule can reuse create()/sign() for the guest
  // (token-scoped, login-less) delivery flow — same MSR pipeline as the
  // authenticated field flow, including the advanceDeliveryItem bridge.
  exports: [MaintenanceReportsService],
})
export class MaintenanceReportsModule {}
