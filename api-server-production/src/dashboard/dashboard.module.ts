import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PrismaModule } from 'src/common/prisma.module';
import { SiteClockModule } from 'src/siteclock/siteclock.module';
import { JobsCalendarService } from './jobs-calendar.service';
import { CalendarNotesService } from './calendar-notes.service';

@Module({
  imports: [PrismaModule, SiteClockModule],
  controllers: [DashboardController],
  providers: [DashboardService, JobsCalendarService, CalendarNotesService],
  exports: [DashboardService],
})
export class DashboardModule {}
