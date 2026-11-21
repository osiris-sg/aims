import { Module, forwardRef } from '@nestjs/common';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { FieldJobsController } from './jobs/jobs.controller';
import { FieldJobsService } from './jobs/jobs.service';
import { FieldSchedulesService } from './jobs/schedules.service';
import { PrismaService } from '../common/prisma.service';
import { FieldAreaGuard } from './common/field-area.guard';
import { FieldContextService } from './common/field-context.service';
import { FieldMeController } from './common/field-me.controller';
import { FieldPeopleController } from './people/people.controller';
import { FieldPeopleService } from './people/people.service';

/**
 * Field module (FIELD_PLAN.md): SiteClock's office side, native in AIMS. Every route is behind
 * enableFieldModule + its area flag (FieldAreaGuard; all default off).
 */
@Module({
  // DeliveriesModule: copy day / week creates calendar quick jobs through the calendar's own path.
  imports: [forwardRef(() => DeliveriesModule)],
  controllers: [FieldMeController, FieldPeopleController, FieldJobsController],
  providers: [PrismaService, FieldContextService, FieldAreaGuard, FieldPeopleService, FieldJobsService, FieldSchedulesService],
  exports: [FieldContextService, FieldPeopleService],
})
export class FieldModule {}
