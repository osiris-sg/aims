import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PublicApiController } from './public-api.controller';
import { PublicApiService } from './public-api.service';
import { ApiKeyGuard } from './api-key.guard';

// Cross-system pull API for water-sg. Self-contained: only needs Prisma and the
// (global) ConfigService the ApiKeyGuard reads WATER_SG_INBOUND_API_KEY from.
@Module({
  controllers: [PublicApiController],
  providers: [PublicApiService, PrismaService, ApiKeyGuard],
})
export class PublicApiModule {}
