import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CustomerInfoService } from './customer-info.service';
import { CustomerInfoController } from './customer-info.controller';
import { PublicCustomerInfoController } from './public-customer-info.controller';

/**
 * Customer Information collection: an authenticated office controller (list /
 * detail / mint / revoke / regenerate) and a @Public() token controller
 * (view / submit). The recipient fills in DO + Invoice contacts only.
 */
@Module({
  controllers: [CustomerInfoController, PublicCustomerInfoController],
  providers: [CustomerInfoService, PrismaService],
})
export class CustomerInfoModule {}
