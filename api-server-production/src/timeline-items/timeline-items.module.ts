import { Module } from '@nestjs/common';
import { TimelineItemsService } from './timeline-items.service';
import { TimelineItemsController } from './timeline-items.controller';
import { PrismaService } from 'src/common/prisma.service';

@Module({
  controllers: [TimelineItemsController],
  providers: [TimelineItemsService, PrismaService],
})
export class TimelineItemsModule {}
