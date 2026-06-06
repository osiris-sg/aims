import { Module } from '@nestjs/common';
import { FixedAssetsController } from './fixed-assets.controller';
import { FixedAssetsService } from './fixed-assets.service';
import { JournalModule } from '../journal/journal.module';
import { PrismaService } from '../common/prisma.service';

@Module({
  imports: [JournalModule],
  controllers: [FixedAssetsController],
  providers: [FixedAssetsService, PrismaService],
  exports: [FixedAssetsService],
})
export class FixedAssetsModule {}
