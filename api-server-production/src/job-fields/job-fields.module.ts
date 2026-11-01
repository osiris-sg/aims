import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { JobFieldsController } from './job-fields.controller';
import { JobFieldsService } from './job-fields.service';

// Custom job fields (enableJobFields, 2026-11-01): admin definitions of the
// org's own fields on jobs (Delivery runs). Values are saved by the deliveries routes.
@Module({
  controllers: [JobFieldsController],
  providers: [JobFieldsService, PrismaService],
  exports: [JobFieldsService],
})
export class JobFieldsModule {}
