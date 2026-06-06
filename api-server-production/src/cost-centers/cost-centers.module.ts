import { Module } from '@nestjs/common';
import { CostCentersController } from './cost-centers.controller';
import { CostCentersService } from './cost-centers.service';
import { PrismaService } from '../common/prisma.service';

@Module({
  controllers: [CostCentersController],
  providers: [CostCentersService, PrismaService],
  exports: [CostCentersService],
})
export class CostCentersModule {}
