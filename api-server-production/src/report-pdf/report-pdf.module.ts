import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { StatementsModule } from '../statements/statements.module';
import { JournalModule } from '../journal/journal.module';
import { PrismaService } from '../common/prisma.service';
import { ReportPdfController } from './report-pdf.controller';
import { ReportPdfService } from './report-pdf.service';

@Module({
  imports: [CommonModule, StatementsModule, JournalModule],
  controllers: [ReportPdfController],
  providers: [ReportPdfService, PrismaService],
  exports: [ReportPdfService],
})
export class ReportPdfModule {}
