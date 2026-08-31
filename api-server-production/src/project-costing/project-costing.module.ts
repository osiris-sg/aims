import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { BillsModule } from '../bills/bills.module';
import { DocumentsModule } from '../documents/documents.module';
import { IdProjectsListController, ProjectCostingController, PublicScheduleController } from './project-costing.controller';
import { ProjectCostingService } from './project-costing.service';

/**
 * Interior-design project costing summary. BillsModule supplies the supplier
 * invoice extractor (same Claude prompt the AP bills upload uses);
 * DocumentsModule creates the progress-claim invoices per milestone.
 */
@Module({
  imports: [BillsModule, DocumentsModule],
  controllers: [PublicScheduleController, IdProjectsListController, ProjectCostingController],
  providers: [ProjectCostingService, PrismaService, S3Service],
  exports: [ProjectCostingService],
})
export class ProjectCostingModule {}
