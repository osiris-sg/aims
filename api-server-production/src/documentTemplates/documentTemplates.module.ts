import { Module } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { DocumentTemplatesController } from './documentTemplates.controller';
import { DocumentTemplatesService } from './documentTemplates.service';

@Module({
  controllers: [DocumentTemplatesController],
  providers: [DocumentTemplatesService, PrismaService],
  // Exported so MaintenanceReportsModule can reuse getTemplateFieldDefinitions
  // for the field-accessible do-view aggregator endpoint.
  exports: [DocumentTemplatesService],
})
export class DocumentTemplatesModule {}
