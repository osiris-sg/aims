import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { MaintenanceReportsModule } from '../maintenance-reports/maintenance-reports.module';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { UploadsService } from '../uploads/uploads.service';
import { PublicDeliveryController } from './public-delivery.controller';
import { PublicDeliveryService } from './public-delivery.service';

@Module({
  // MaintenanceReportsModule exports MaintenanceReportsService (guest DO_START
  // uses the SAME MSR create as the field flow). DeliveriesModule exports
  // DeliveriesService (markUnitDelivered / startFreeTypedItem / endFreeTypedItem
  // / finalizeRun) — the guest drives the RUN through the same methods the rider
  // does. Both import-chains are one-way (no cycle back to PublicDelivery).
  // UploadsService is added directly (it only depends on the global ConfigService)
  // for the token-scoped POD photo upload.
  imports: [MaintenanceReportsModule, DeliveriesModule],
  controllers: [PublicDeliveryController],
  providers: [PublicDeliveryService, PrismaService, UploadsService],
})
export class PublicDeliveryModule {}
