import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { InventoryReportsController } from './inventory-reports.controller';
import { InventoryReportsService } from './inventory-reports.service';

// Inventory → Reports: the ten legacy Inventory Reports (guru 2026-11-25).
@Module({
  controllers: [InventoryReportsController],
  providers: [InventoryReportsService, PrismaService],
})
export class InventoryReportsModule {}
