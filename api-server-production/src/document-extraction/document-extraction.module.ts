import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DocumentExtractionService } from './document-extraction.service';
import { DocumentExtractionController } from './document-extraction.controller';
import { PrismaModule } from '../common/prisma.module';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [DocumentExtractionController],
  providers: [DocumentExtractionService],
  exports: [DocumentExtractionService],
})
export class DocumentExtractionModule {}