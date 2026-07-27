import { Module } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { DocumentsModule } from '../documents/documents.module';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';

@Module({
  // DocumentsModule exports DocumentsService — used for the link-time
  // deduction wrapper (deductLinkedDeliveryUnits) and createBasicDocument
  // (create-DO-from-delivery).
  imports: [DocumentsModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService, PrismaService],
  // Exported so MaintenanceReportsService can bridge standalone-run MSRs
  // (deliveryId set, documentId null) into the DeliveryItem state machine.
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
