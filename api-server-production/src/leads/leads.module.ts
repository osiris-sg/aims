import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

/**
 * Sales leads for interior-design orgs: EZiD text emails and Network
 * Singapore PDF distributions land here via the email-ingestion webhook;
 * designers work them from Sales → Leads. Exported so IngestionEmailModule
 * can route lead emails in.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [LeadsController],
  providers: [LeadsService, PrismaService, S3Service],
  exports: [LeadsService],
})
export class LeadsModule {}
