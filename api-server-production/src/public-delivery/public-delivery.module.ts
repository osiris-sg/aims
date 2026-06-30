import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { DocumentsModule } from '../documents/documents.module';
import { UploadsService } from '../uploads/uploads.service';
import { PublicDeliveryController } from './public-delivery.controller';
import { PublicDeliveryService } from './public-delivery.service';

@Module({
  // DocumentsModule exports DocumentsService (advanceDeliveryItem). UploadsService
  // is added directly here (it only depends on the global ConfigService) for the
  // token-scoped POD photo upload.
  imports: [DocumentsModule],
  controllers: [PublicDeliveryController],
  providers: [PublicDeliveryService, PrismaService, UploadsService],
})
export class PublicDeliveryModule {}
