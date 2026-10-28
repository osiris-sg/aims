import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { DocumentsModule } from '../documents/documents.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectCostingModule } from '../project-costing/project-costing.module';
import { EmailModule } from '../email/email.module';
import { StaffWhatsAppModule } from '../staff-whatsapp/staff-whatsapp.module';
import { WhatsAppAdapterModule } from '../operator/adapters/whatsapp-adapter.module';
import { PublicSignController } from './public-sign.controller';
import { PublicSignService } from './public-sign.service';

/**
 * Client e-signature for quotations. DocumentsModule for the shared print
 * renderer + PDF; NotificationsModule for the office bell on signature;
 * ProjectCostingModule to seed the payment schedule on the new project;
 * EmailModule + WhatsAppAdapterModule to SEND the link to the customer;
 * StaffWhatsAppModule to tell the office on WhatsApp when the client signs.
 */
@Module({
  imports: [DocumentsModule, NotificationsModule, ProjectCostingModule, EmailModule, StaffWhatsAppModule, WhatsAppAdapterModule],
  controllers: [PublicSignController],
  providers: [PublicSignService, PrismaService],
  // Exported for the Operator's send_for_signature tool.
  exports: [PublicSignService],
})
export class PublicSignModule {}
