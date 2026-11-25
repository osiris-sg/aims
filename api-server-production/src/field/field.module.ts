import { Module, forwardRef } from '@nestjs/common';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { FieldJobsController } from './jobs/jobs.controller';
import { FieldJobsService } from './jobs/jobs.service';
import { FieldSchedulesService } from './jobs/schedules.service';
import { FieldAutoCloseCron } from './engine/autoclose.cron';
import { FieldPunchesController } from './punches/punches.controller';
import { FieldPunchesService } from './punches/punches.service';
import { FieldTimesheetsController } from './timesheets/timesheets.controller';
import { FieldTimesheetsService } from './timesheets/timesheets.service';
import { FieldLeaveController } from './leave/leave.controller';
import { FieldLeaveService } from './leave/leave.service';
import { FieldPayrollController } from './payroll/payroll.controller';
import { FieldPayrollService } from './payroll/payroll.service';
import { FieldReportsController } from './reports/reports.controller';
import { FieldReportsService } from './reports/reports.service';
import { PrismaService } from '../common/prisma.service';
import { FieldAreaGuard } from './common/field-area.guard';
import { FieldContextService } from './common/field-context.service';
import { FieldMeController } from './common/field-me.controller';
import { FieldPeopleController } from './people/people.controller';
import { FieldPeopleService } from './people/people.service';
import { S3Service } from '../common/services/s3.service';
import { FieldAppGuard } from './app/app-context';
import { FieldAppController, FieldAppVersionController } from './app/app.controller';
import { FieldAppService } from './app/app.service';
import { FieldAppAccessService } from './app/app-access.service';

/**
 * Field module (FIELD_PLAN.md): SiteClock's office side, native in AIMS. Every route is behind
 * enableFieldModule + its area flag (FieldAreaGuard; all default off). app/: the worker side the AIMS
 * phone app calls (/field/app/*, FieldAppGuard: module on + the login is a worker; clocking needs fieldEngineLive).
 */
@Module({
  // DeliveriesModule: copy day / week creates calendar quick jobs through the calendar's own path.
  imports: [forwardRef(() => DeliveriesModule)],
  controllers: [FieldAppVersionController, FieldAppController, FieldMeController, FieldPeopleController, FieldJobsController, FieldPunchesController, FieldTimesheetsController, FieldLeaveController, FieldPayrollController, FieldReportsController],
  providers: [PrismaService, S3Service, FieldContextService, FieldAreaGuard, FieldAppGuard, FieldAppService, FieldAppAccessService, FieldPeopleService, FieldJobsService, FieldSchedulesService, FieldPunchesService, FieldAutoCloseCron, FieldTimesheetsService, FieldLeaveService, FieldPayrollService, FieldReportsService],
  exports: [FieldContextService, FieldPeopleService],
})
export class FieldModule {}
