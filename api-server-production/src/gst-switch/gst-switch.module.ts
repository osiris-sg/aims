import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { DocumentsModule } from '../documents/documents.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { GstSwitchController } from './gst-switch.controller';
import { GstSwitchService } from './gst-switch.service';

/** GST switch with company move (WCT group, 2026-11-24). ActionLogService comes from the global ActionLogModule. */
@Module({
  imports: [DocumentsModule, ReceiptsModule],
  controllers: [GstSwitchController],
  providers: [GstSwitchService, PrismaService],
})
export class GstSwitchModule {}
