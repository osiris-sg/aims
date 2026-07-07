import { Module } from '@nestjs/common';
import { DocumentNumberingService } from './document-numbering.service';
import { DocumentNumberingController } from './document-numbering.controller';
import { PrismaService } from '../common/prisma.service';

@Module({
  controllers: [DocumentNumberingController],
  providers: [DocumentNumberingService, PrismaService],
  exports: [DocumentNumberingService],
})
export class DocumentNumberingModule {}
