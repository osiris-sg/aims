import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { MaintenanceReportsModule } from '../maintenance-reports/maintenance-reports.module';
import { ServiceReportSignController } from './service-report-sign.controller';
import { ServiceReportSignService } from './service-report-sign.service';

/**
 * Remote customer signature for SERVICE reports. MaintenanceReportsModule
 * exports MaintenanceReportsService so the public sign runs the SAME sign()
 * as the on-site flow, and renderReportPdf for the token-scoped PDF.
 * PrismaService is listed here because it is not a global provider.
 */
@Module({
  imports: [MaintenanceReportsModule],
  controllers: [ServiceReportSignController],
  providers: [ServiceReportSignService, PrismaService, UploadsService],
})
export class ServiceReportSignModule {}
