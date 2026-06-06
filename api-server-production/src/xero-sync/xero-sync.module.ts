import { Module } from '@nestjs/common';
import { XeroSyncController } from './xero-sync.controller';
import { XeroSyncService } from './xero-sync.service';
import { PrismaService } from '../common/prisma.service';

@Module({
  controllers: [XeroSyncController],
  providers: [XeroSyncService, PrismaService],
  exports: [XeroSyncService],
})
export class XeroSyncModule {}
