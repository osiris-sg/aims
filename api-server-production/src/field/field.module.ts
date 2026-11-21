import { Module } from '@nestjs/common';
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
  controllers: [FieldMeController, FieldPeopleController],
  providers: [PrismaService, FieldContextService, FieldAreaGuard, FieldPeopleService],
  exports: [FieldContextService, FieldPeopleService],
})
export class FieldModule {}
