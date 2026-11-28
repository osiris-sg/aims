import { Module } from '@nestjs/common';
import { SalesReportsController } from './sales-reports.controller';
import { SalesReportsService } from './sales-reports.service';
import { PrismaService } from '../common/prisma.service';
import { CommissionController } from './commission.controller';
import { CommissionService } from './commission.service';

@Module({
  controllers: [CommissionController, SalesReportsController],
  providers: [SalesReportsService, CommissionService, PrismaService],
  exports: [SalesReportsService],
})
export class SalesReportsModule {}
