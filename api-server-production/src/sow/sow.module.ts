import { Module } from '@nestjs/common';
import { SowController } from './sow.controller';
import { SowService } from './sow.service';
import { CommonModule } from '../common/common.module';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentTemplatesModule } from '../documentTemplates/documentTemplates.module';

@Module({
  imports: [CommonModule, DocumentsModule, DocumentTemplatesModule],
  controllers: [SowController],
  providers: [SowService],
})
export class SowModule {}
