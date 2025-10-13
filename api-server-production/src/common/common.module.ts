import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { XeroService } from './xero.service';
import { XeroController } from './xero.controller';
import { AuditService } from './audit.service';
import { PrismaService } from './prisma.service';
import { S3Service } from './services/s3.service';
import { PdfGeneratorService } from './services/pdf-generator.service';

@Module({
  imports: [ConfigModule],
  controllers: [XeroController],
  providers: [
    XeroService,
    AuditService,
    PrismaService,
    S3Service,
    PdfGeneratorService,
  ],
  exports: [
    XeroService,
    AuditService,
    PrismaService,
    S3Service,
    PdfGeneratorService,
  ],
})
export class CommonModule {}
