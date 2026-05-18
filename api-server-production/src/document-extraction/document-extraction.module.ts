import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DocumentExtractionService } from './document-extraction.service';
import { DocumentExtractionController } from './document-extraction.controller';
import { PrismaModule } from '../common/prisma.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [ConfigModule, PrismaModule, CommonModule],
  controllers: [DocumentExtractionController],
  providers: [DocumentExtractionService],
  exports: [DocumentExtractionService],
})
export class DocumentExtractionModule {}