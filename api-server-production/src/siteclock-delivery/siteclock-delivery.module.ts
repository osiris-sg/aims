import { Module, forwardRef } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { MaintenanceReportsModule } from '../maintenance-reports/maintenance-reports.module';
import { DeliveryGroupPostsModule } from '../delivery-group-posts/delivery-group-posts.module';
import { SiteClockModule } from '../siteclock/siteclock.module';
import { SiteClockInboundGuard } from '../job-photos/siteclock-inbound.guard';
import { UploadsService } from '../uploads/uploads.service';
import { SiteClockDeliveryController } from './siteclock-delivery.controller';
import { SiteClockWorkerGuard } from './siteclock-worker.guard';

// SiteClock worker delivery API (2026-11-06, flag enableSiteClockDeliveries):
// the SiteClock app's Delivery section, via SiteClock's backend. Reuses the
// SiteJobs services (DeliveriesModule, MaintenanceReportsModule) and the DO
// render of the WhatsApp group posts (DeliveryGroupPostsModule); SiteClockModule
// gives the inbound key guard its link check. PrismaService is per-module here
// (guards, the Idempotency-Key store).
@Module({
  imports: [forwardRef(() => DeliveriesModule), MaintenanceReportsModule, DeliveryGroupPostsModule, SiteClockModule],
  controllers: [SiteClockDeliveryController],
  providers: [PrismaService, UploadsService, SiteClockInboundGuard, SiteClockWorkerGuard],
})
export class SiteClockDeliveryModule {}
