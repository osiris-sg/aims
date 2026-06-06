import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { PrismaService } from '../common/prisma.service';
import { CommonModule } from '../common/common.module';
import { DocumentExtractionModule } from '../document-extraction/document-extraction.module';

@Module({
  imports: [CommonModule, DocumentExtractionModule],
  controllers: [OrdersController],
  providers: [OrdersService, PrismaService],
  exports: [OrdersService],
})
export class OrdersModule {}
