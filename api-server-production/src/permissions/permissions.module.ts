// src/permissions/permissions.module.ts
import { Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { PermissionsController } from './permissions.controller';
import { PrismaService } from '../common/prisma.service';
import { PrismaModule } from 'src/common/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PermissionsController],
  providers: [PermissionsService, PrismaService],
  exports: [PermissionsService],
})
export class PermissionsModule {}