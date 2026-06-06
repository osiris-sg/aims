import { Module } from '@nestjs/common';
import { AnomaliesService } from './anomalies.service';
import { PrismaService } from '../common/prisma.service';

@Module({
  providers: [AnomaliesService, PrismaService],
  exports: [AnomaliesService],
})
export class AnomaliesModule {}
