import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { TemplateStatusService } from '../template-status.service';
import { WhatsAppAdapter } from './whatsapp.adapter';

/**
 * The WhatsApp Cloud API sender on its own (guru 2026-10-28: the quotation
 * sign link goes to the customer's WhatsApp from the editor AND from the
 * agent). Lives outside OperatorModule so a module the Operator itself
 * imports (PublicSignModule) can send without a cycle. ONE instance app-wide:
 * the adapter keeps per-chat reply context in memory, so OperatorModule
 * imports this module instead of providing the adapter a second time.
 */
@Module({
  providers: [WhatsAppAdapter, TemplateStatusService, PrismaService],
  exports: [WhatsAppAdapter, TemplateStatusService],
})
export class WhatsAppAdapterModule {}
