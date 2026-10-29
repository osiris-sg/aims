import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { SiteClockLinkService } from './siteclock-link.service';
import { SiteClockAdminController } from './siteclock.admin.controller';

// SiteClock link (WCT 2026-10-30): delivery runs → jobs on a SiteClock worker's
// schedule. DeliveriesModule imports this for the sync hooks and the office routes.
@Module({
  imports: [NotificationsModule],
  controllers: [SiteClockAdminController],
  providers: [SiteClockLinkService, PrismaService],
  exports: [SiteClockLinkService],
})
export class SiteClockModule {}
