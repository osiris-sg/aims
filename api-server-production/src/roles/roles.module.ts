// src/roles/roles.module.ts
import { Module } from '@nestjs/common';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';
import { PrismaService } from 'src/common/prisma.service';
import { PrismaModule } from 'src/common/prisma.module';


@Module({
  imports: [PrismaModule],
  controllers: [RolesController],
  providers: [RolesService, PrismaService],
  exports: [RolesService],
})
export class RolesModule {}