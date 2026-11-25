import { Module } from '@nestjs/common';
import { SalesReportsController } from './sales-reports.controller';
import { SalesReportsService } from './sales-reports.service';
import { PrismaService } from '../common/prisma.service';

@Module({
  controllers: [SalesReportsController],
  providers: [SalesReportsService, PrismaService],
  exports: [SalesReportsService],
})
export class SalesReportsModule {}
