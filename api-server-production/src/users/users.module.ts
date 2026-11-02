// src/users/users.module.ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from '../common/prisma.module';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MembershipsService } from './memberships.service';

@Module({
  imports: [PrismaModule, EmailModule, NotificationsModule],
  controllers: [UsersController],
  providers: [UsersService, MembershipsService],
  exports: [UsersService],
})
export class UsersModule {}
