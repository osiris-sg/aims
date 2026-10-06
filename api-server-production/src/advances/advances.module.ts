import { Module } from '@nestjs/common';
import { AdvancesController } from './advances.controller';
import { AdvancesService } from './advances.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaService } from '../common/prisma.service';

@Module({
  imports: [NotificationsModule],
  controllers: [AdvancesController],
  providers: [AdvancesService, PrismaService],
  exports: [AdvancesService],
})
export class AdvancesModule {}
