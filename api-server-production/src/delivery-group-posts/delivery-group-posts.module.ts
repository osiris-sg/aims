import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { PrismaService } from '../common/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PublicDocumentModule } from '../public-document/public-document.module';
import { DeliveryGroupPostsController } from './delivery-group-posts.controller';
import { DeliveryGroupPostsService } from './delivery-group-posts.service';
import { WaPostController } from './wa-post.controller';

/**
 * Delivery group posts (2026-09-30): each delivery sign-off is posted to the
 * project's WhatsApp group (caption, photos, signed DO) by the post-only
 * whatsapp-post-bridge worker. Queued by DeliveriesService (./enqueue.ts).
 * Per-org flag enableDeliveryGroupPosts.
 */
@Module({
  imports: [CommonModule, NotificationsModule, PublicDocumentModule],
  controllers: [DeliveryGroupPostsController, WaPostController],
  providers: [DeliveryGroupPostsService, PrismaService],
  exports: [DeliveryGroupPostsService],
})
export class DeliveryGroupPostsModule {}
