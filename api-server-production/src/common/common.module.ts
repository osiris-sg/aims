import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { XeroService } from './xero.service';
import { XeroController } from './xero.controller';
import { AuditService } from './audit.service';
import { PrismaService } from './prisma.service';
import { S3Service } from './services/s3.service';
import { PdfGeneratorService } from './services/pdf-generator.service';
import { WaterSgService } from './services/water-sg.service';

@Module({
  imports: [ConfigModule],
  controllers: [XeroController],
  providers: [
    XeroService,
    AuditService,
    PrismaService,
    S3Service,
    PdfGeneratorService,
    WaterSgService,
  ],
  exports: [
    XeroService,
    AuditService,
    PrismaService,
    S3Service,
    PdfGeneratorService,
    WaterSgService,
  ],
})
export class CommonModule {}
