import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { DocumentsModule } from '../documents/documents.module';
import { PublicDocumentController } from './public-document.controller';
import { PublicDocumentService } from './public-document.service';

/**
 * View-only document link. DocumentsModule is imported so the public GET can
 * reuse DocumentsService.getById to build the SAME render payload the portal
 * preview uses; the output is whitelisted before it leaves the service. No
 * mutation surface — the public controller exposes only a GET.
 */
@Module({
  imports: [DocumentsModule],
  controllers: [PublicDocumentController],
  providers: [PublicDocumentService, PrismaService],
})
export class PublicDocumentModule {}
