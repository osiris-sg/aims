import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { DocOrderRefController } from './doc-order-ref.controller';
import { DocOrderRefService } from './doc-order-ref.service';
import { PrismaService } from '../common/prisma.service';
import { CommonModule } from '../common/common.module';
import { DocumentExtractionModule } from '../document-extraction/document-extraction.module';

@Module({
  imports: [CommonModule, DocumentExtractionModule],
  controllers: [OrdersController, DocOrderRefController],
  providers: [OrdersService, DocOrderRefService, PrismaService],
  exports: [OrdersService],
})
export class OrdersModule {}
