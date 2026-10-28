import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StaffWhatsAppService } from './staff-whatsapp.service';

/** Staff lifecycle pushes on WhatsApp (queue side only; the Operator's outbox worker sends). */
@Module({
  providers: [StaffWhatsAppService, PrismaService],
  exports: [StaffWhatsAppService],
})
export class StaffWhatsAppModule {}
