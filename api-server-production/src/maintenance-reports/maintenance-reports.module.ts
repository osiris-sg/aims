import { Module } from '@nestjs/common';
import { CommonModule } from 'src/common/common.module';
import { PrismaService } from 'src/common/prisma.service';
import { EmailModule } from '../email/email.module';
import { DocumentsModule } from '../documents/documents.module';
import { MaintenanceReportsController } from './maintenance-reports.controller';
import { MaintenanceReportsService } from './maintenance-reports.service';

@Module({
  // CommonModule exports PdfGeneratorService (puppeteer wrapper).
  // EmailModule exports EmailService (Resend client) for the auto-email path
  // when paymentRequired === false.
  // DocumentsModule exports DocumentsService.createBasicDocument used to spin
  // off an Invoice document from an MSR with paymentRequired === true.
  imports: [CommonModule, EmailModule, DocumentsModule],
  controllers: [MaintenanceReportsController],
  providers: [MaintenanceReportsService, PrismaService],
})
export class MaintenanceReportsModule {}
