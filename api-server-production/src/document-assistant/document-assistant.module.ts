import { Module } from '@nestjs/common';
import { DocumentAssistantController } from './document-assistant.controller';
import { DocumentAssistantService } from './document-assistant.service';
import { EmbeddingsService } from './embeddings.service';
import { PrismaService } from '../common/prisma.service';

@Module({
  controllers: [DocumentAssistantController],
  // ClerkAuthGuard depends on PrismaService, so (like AskModule) this module
  // provides its own PrismaService. EmbeddingsService is exported so a backfill
  // script / other modules can reuse it.
  providers: [DocumentAssistantService, EmbeddingsService, PrismaService],
  exports: [EmbeddingsService],
})
export class DocumentAssistantModule {}
