import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { PrismaService } from 'src/common/prisma.service';
import { CommonModule } from 'src/common/common.module';
import { PriceHistoryModule } from '../price-history/price-history.module';

@Module({
  imports: [CommonModule, PriceHistoryModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, PrismaService],
})
export class DocumentsModule {}
