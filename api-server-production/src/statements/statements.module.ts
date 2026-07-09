import { Module } from '@nestjs/common';
import { StatementsService } from './statements.service';
import { XeroReportsService } from './xero-reports.service';
import { StatementsController } from './statements.controller';
import { PrismaService } from '../common/prisma.service';

@Module({
  controllers: [StatementsController],
  providers: [StatementsService, XeroReportsService, PrismaService],
  exports: [StatementsService, XeroReportsService],
})
export class StatementsModule {}
