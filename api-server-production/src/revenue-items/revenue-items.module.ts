import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { RevenueItemsController } from './revenue-items.controller';
import { RevenueItemsService } from './revenue-items.service';

@Module({
  controllers: [RevenueItemsController],
  providers: [RevenueItemsService, PrismaService],
  exports: [RevenueItemsService],
})
export class RevenueItemsModule {}
