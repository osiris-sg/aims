import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { DocumentsModule } from '../documents/documents.module';
import { CustomerInfoService } from './customer-info.service';
import { CustomerInfoController } from './customer-info.controller';
import { PublicCustomerInfoController } from './public-customer-info.controller';

/**
 * Customer Information collection: an authenticated office controller (list /
 * detail / mint / revoke / regenerate / PO picker) and a @Public() token
 * controller (view / submit / PO upload). DocumentsModule is imported so the
 * public PO upload can create a file-only PO document via the SAME
 * createFromExtraction path the /submit intake uses; S3Service stores the file.
 */
@Module({
  imports: [DocumentsModule],
  controllers: [CustomerInfoController, PublicCustomerInfoController],
  providers: [CustomerInfoService, PrismaService, S3Service],
})
export class CustomerInfoModule {}
