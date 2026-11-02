import { Module, forwardRef } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { DocumentsModule } from '../documents/documents.module';
import { SiteClockModule } from '../siteclock/siteclock.module';
import { JobPhotosController } from './job-photos.controller';
import { JobPhotosService } from './job-photos.service';
import { SiteClockInboundController } from './siteclock-inbound.controller';
import { SiteClockInboundGuard } from './siteclock-inbound.guard';

// Job photos from SiteClock (WCT 2026-11-02): SiteClock pushes the photos of
// AIMS jobs here (inbound key); the office sees them on the job and its order.
// DocumentsModule (forwardRef'd, it sits on the Documents/Deliveries cycle)
// gives the DO attachments; SiteClockModule the link gating.
@Module({
  imports: [forwardRef(() => DocumentsModule), SiteClockModule],
  controllers: [SiteClockInboundController, JobPhotosController],
  providers: [JobPhotosService, SiteClockInboundGuard, PrismaService, S3Service],
  exports: [JobPhotosService],
})
export class JobPhotosModule {}
