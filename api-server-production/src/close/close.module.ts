import { Module } from '@nestjs/common';
import { CloseController } from './close.controller';
import { CloseService } from './close.service';
import { JournalModule } from '../journal/journal.module';
import { FixedAssetsModule } from '../fixed-assets/fixed-assets.module';
import { PrismaService } from '../common/prisma.service';

@Module({
  imports: [JournalModule, FixedAssetsModule],
  controllers: [CloseController],
  providers: [CloseService, PrismaService],
})
export class CloseModule {}
