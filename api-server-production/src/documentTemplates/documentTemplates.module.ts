import { Module } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { DocumentTemplatesController } from './documentTemplates.controller';
import { DocumentTemplatesService } from './documentTemplates.service';
import { S3Service } from 'src/common/services/s3.service';

@Module({
  controllers: [DocumentTemplatesController],
  providers: [DocumentTemplatesService, PrismaService, S3Service],
  // Exported so MaintenanceReportsModule can reuse getTemplateFieldDefinitions
  // for the field-accessible do-view aggregator endpoint.
  exports: [DocumentTemplatesService],
})
export class DocumentTemplatesModule {}
