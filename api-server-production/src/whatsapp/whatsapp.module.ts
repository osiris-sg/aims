import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';

// WhatsApp Business Platform (Meta Cloud API) integration. Orgs connect their
// own number via Embedded Signup (we are the Tech Provider app); the module
// stores the per-org WABA/phone/token, receives inbound webhooks, and sends
// template/text messages.
@Module({
  controllers: [WhatsAppController],
  providers: [WhatsAppService, PrismaService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
