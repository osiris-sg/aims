import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { WorkersTeamsController } from './workers-teams.controller';
import { WorkersTeamsService } from './workers-teams.service';

// Workers & Teams (WCT 2026-11-20, flag enableWorkersTeams): Settings > Workers & Teams, synced from SiteClock.
@Module({
  controllers: [WorkersTeamsController],
  providers: [WorkersTeamsService, PrismaService],
  exports: [WorkersTeamsService],
})
export class WorkersTeamsModule {}
