import { Module } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { MaintenanceSchedulesController } from './maintenance-schedules.controller';
import { MaintenanceSchedulesService } from './maintenance-schedules.service';

// PushService and ActionLogService come from their @Global modules.
@Module({
  imports: [NotificationsModule],
  controllers: [MaintenanceSchedulesController],
  providers: [MaintenanceSchedulesService, PrismaService],
})
export class MaintenanceSchedulesModule {}
