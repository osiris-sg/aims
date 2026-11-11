import { Module } from '@nestjs/common';
import { StatementsService } from './statements.service';
import { XeroReportsService } from './xero-reports.service';
import { StatementsController } from './statements.controller';
import { PrismaService } from '../common/prisma.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [StatementsController],
  providers: [StatementsService, XeroReportsService, PrismaService],
  exports: [StatementsService, XeroReportsService],
})
export class StatementsModule {}
