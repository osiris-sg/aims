import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuditController } from './audit.controller';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { ClerkClientProvider } from '../providers/clerk-client.provider';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  controllers: [AdminController, AuditController],
  providers: [AdminService, AuditService, PrismaService, ClerkClientProvider],
  exports: [AdminService, AuditService],
})
export class AdminModule {}
