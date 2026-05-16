import { Module } from '@nestjs/common';
import { CommonModule } from 'src/common/common.module';
import { PrismaService } from 'src/common/prisma.service';
import { MaintenanceReportsController } from './maintenance-reports.controller';
import { MaintenanceReportsService } from './maintenance-reports.service';

@Module({
  imports: [CommonModule],
  controllers: [MaintenanceReportsController],
  providers: [MaintenanceReportsService, PrismaService],
})
export class MaintenanceReportsModule {}
