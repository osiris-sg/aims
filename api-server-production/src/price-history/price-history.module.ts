import { Module } from '@nestjs/common';
import { PriceHistoryService } from './price-history.service';
import { PriceHistoryController } from './price-history.controller';
import { PrismaService } from '../common/prisma.service';

@Module({
  controllers: [PriceHistoryController],
  providers: [PriceHistoryService, PrismaService],
  exports: [PriceHistoryService],
})
export class PriceHistoryModule {}