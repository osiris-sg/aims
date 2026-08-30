import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { DocumentsModule } from '../documents/documents.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectCostingModule } from '../project-costing/project-costing.module';
import { PublicSignController } from './public-sign.controller';
import { PublicSignService } from './public-sign.service';

/**
 * Client e-signature for quotations. DocumentsModule for the shared print
 * renderer + PDF; NotificationsModule for the office bell on signature;
 * ProjectCostingModule to seed the payment schedule on the new project.
 */
@Module({
  imports: [DocumentsModule, NotificationsModule, ProjectCostingModule],
  controllers: [PublicSignController],
  providers: [PublicSignService, PrismaService],
})
export class PublicSignModule {}
