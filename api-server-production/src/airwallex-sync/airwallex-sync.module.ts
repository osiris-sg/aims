import { Module } from '@nestjs/common';
import { AirwallexSyncController } from './airwallex-sync.controller';
import { AirwallexSyncService } from './airwallex-sync.service';
import { PrismaService } from '../common/prisma.service';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  controllers: [AirwallexSyncController],
  providers: [AirwallexSyncService, PrismaService],
  exports: [AirwallexSyncService],
})
export class AirwallexSyncModule {}
