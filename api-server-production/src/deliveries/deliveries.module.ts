import { Module } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { DocumentsModule } from '../documents/documents.module';
import { ProjectsModule } from '../projects/projects.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';

@Module({
  // DocumentsModule exports DocumentsService — link/commit + createBasicDocument
  // (create-DO-from-delivery). ProjectsModule exports ProjectsService — the
  // in-flow assign step delegates to fieldDeploy (no duplicated assign logic).
  // NotificationsModule exports NotificationsService — RDO_READY on return
  // completion (the DO/invoice bells fire from DocumentsService).
  imports: [DocumentsModule, ProjectsModule, NotificationsModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService, PrismaService],
  // Exported so MaintenanceReportsService can bridge standalone-run MSRs
  // (deliveryId set, documentId null) into the DeliveryItem state machine.
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
