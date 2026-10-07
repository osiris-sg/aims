import { Module } from '@nestjs/common';
import { AppointmentsController, PublicBookingController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaService } from '../common/prisma.service';

@Module({
  imports: [NotificationsModule],
  controllers: [AppointmentsController, PublicBookingController],
  providers: [AppointmentsService, PrismaService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
