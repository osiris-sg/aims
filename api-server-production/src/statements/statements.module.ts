import { Module } from '@nestjs/common';
import { StatementsService } from './statements.service';
import { StatementsController } from './statements.controller';
import { PrismaService } from '../common/prisma.service';

@Module({
  controllers: [StatementsController],
  providers: [StatementsService, PrismaService],
  exports: [StatementsService],
})
export class StatementsModule {}
