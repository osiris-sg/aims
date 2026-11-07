import { Module } from '@nestjs/common';
import { PayablesController } from './payables.controller';
import { PayablesService } from './payables.service';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { BillsModule } from '../bills/bills.module';

@Module({
  imports: [BillsModule],
  controllers: [PayablesController],
  providers: [PayablesService, PrismaService, S3Service],
  exports: [PayablesService],
})
export class PayablesModule {}
