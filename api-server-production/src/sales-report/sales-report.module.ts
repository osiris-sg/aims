import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { SalesReportController } from './sales-report.controller';
import { SalesReportService } from './sales-report.service';

// WCT group (2026-11-18): quotation categories + the sales report (quotations per salesperson).
@Module({
  controllers: [SalesReportController],
  providers: [SalesReportService, PrismaService],
})
export class SalesReportModule {}
