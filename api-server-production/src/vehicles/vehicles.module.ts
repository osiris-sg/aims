import { Module } from '@nestjs/common';
import { CommonModule } from 'src/common/common.module';
import { PrismaService } from 'src/common/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

// WCT Vehicles (enableWctVehicles). CommonModule exports PdfGeneratorService;
// NotificationsModule the bell for the COE / lifespan reminders. PrismaService
// is per-module in this app (not global), so it is listed here.
@Module({
  imports: [CommonModule, NotificationsModule],
  controllers: [VehiclesController],
  providers: [VehiclesService, PrismaService],
})
export class VehiclesModule {}
