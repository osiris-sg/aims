import { Module } from '@nestjs/common';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [CustomersModule],
  controllers: [IngestionController],
  providers: [IngestionService, PrismaService, AuditService],
})
export class IngestionModule {}
