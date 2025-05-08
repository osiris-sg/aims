import { Module } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { DocumentTemplatesController } from './documentTemplates.controller';
import { DocumentTemplatesService } from './documentTemplates.service';

@Module({
  controllers: [DocumentTemplatesController],
  providers: [DocumentTemplatesService, PrismaService],
})
export class DocumentTemplatesModule {}
