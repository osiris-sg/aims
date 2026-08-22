import { Global, Module } from '@nestjs/common';
import { ActionLogService } from './action-log.service';
import { ActionLogController } from './action-log.controller';
import { PrismaService } from '../common/prisma.service';

// Global so any feature module (crons, webhooks, workers) can inject
// ActionLogService without importing the module.
@Global()
@Module({
  controllers: [ActionLogController],
  providers: [ActionLogService, PrismaService],
  exports: [ActionLogService],
})
export class ActionLogModule {}
