import { Global, Module } from '@nestjs/common';
import { OrgRulesController } from './org-rules.controller';
import { OrgRulesService } from './org-rules.service';
import { PrismaService } from '../common/prisma.service';

// Global: business rules are read by seeding/costing paths across modules.
@Global()
@Module({
  controllers: [OrgRulesController],
  providers: [OrgRulesService, PrismaService],
  exports: [OrgRulesService],
})
export class OrgRulesModule {}
