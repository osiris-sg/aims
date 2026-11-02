// src/users/users.module.ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from '../common/prisma.module';
import { MembershipsService } from './memberships.service';

@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [UsersService, MembershipsService],
  exports: [UsersService],
})
export class UsersModule {}
