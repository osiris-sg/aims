import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

// Sales-team hierarchy (CIEL 09-19): Teams led by Junior Managers, managed
// from the User Management screen by Master-tier users.
@Module({
  controllers: [TeamsController],
  providers: [TeamsService, PrismaService],
  exports: [TeamsService],
})
export class TeamsModule {}
