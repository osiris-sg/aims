import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

// Global top-nav search (all orgs, no feature flag — like the Guide bubble).
@Module({
  controllers: [SearchController],
  providers: [SearchService, PrismaService],
})
export class SearchModule {}
