import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';

// Custom access (WCT group 2026-11-19). PrismaService is per module here (not global).
@Module({
  controllers: [AccessController],
  providers: [AccessService, PrismaService],
  exports: [AccessService],
})
export class AccessModule {}
