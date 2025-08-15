import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { XeroService } from './xero.service';
import { XeroController } from './xero.controller';
import { AuditService } from './audit.service';
import { PrismaService } from './prisma.service';

@Module({
  imports: [ConfigModule],
  controllers: [XeroController],
  providers: [XeroService, AuditService, PrismaService],
  exports: [XeroService, AuditService, PrismaService],
})
export class CommonModule {}
