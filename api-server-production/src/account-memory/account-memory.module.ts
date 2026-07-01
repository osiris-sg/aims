import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { DocumentAssistantModule } from '../document-assistant/document-assistant.module';
import { AccountMemoryService } from './account-memory.service';

@Module({
  imports: [DocumentAssistantModule], // exports EmbeddingsService
  providers: [AccountMemoryService, PrismaService],
  exports: [AccountMemoryService],
})
export class AccountMemoryModule {}
