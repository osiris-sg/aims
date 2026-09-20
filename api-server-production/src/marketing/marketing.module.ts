import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';

// Meta ads insights for the CRM Marketing page (guru 2026-09-21).
@Module({
  controllers: [MarketingController],
  providers: [MarketingService, PrismaService],
  exports: [MarketingService],
})
export class MarketingModule {}
