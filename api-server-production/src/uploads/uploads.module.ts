import { Module } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { UploadsController } from './uploads.controller';
import { PrismaService } from 'src/common/prisma.service';
@Module({
  controllers: [UploadsController],
  providers: [UploadsService, PrismaService], // PrismaService: the Idempotency-Key store
})
export class UploadsModule {}
