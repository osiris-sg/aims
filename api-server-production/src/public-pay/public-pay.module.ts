import { Module } from '@nestjs/common';
import { PublicPayController } from './public-pay.controller';
import { PublicPayService } from './public-pay.service';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';

@Module({
  imports: [DocumentsModule],
  controllers: [PublicPayController],
  providers: [PublicPayService, PrismaService, S3Service],
})
export class PublicPayModule {}
