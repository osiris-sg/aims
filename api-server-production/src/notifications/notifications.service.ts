import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';

export interface EmitNotificationParams {
  organizationId: string;
  kind: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  linkUrl?: string | null;
}

/**
 * Persistent in-app notifications for the portal header bell.
 *
 * Audience is scoped at WRITE time: recipients are the org's office users,
 * resolved as the holders of the existing `documents:read` permission (the same
 * permission that gates every office DO/invoice screen). Field-tech roles lack
 * it, so they never receive a row — no new permission concept is introduced.
 *
 * Read state is per user (one row per recipient), so one office user reading a
 * notification never hides it from another.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * BEST-EFFORT fan-out. Resolves the office recipients and inserts one row per
   * recipient. NEVER throws: a notification failure must not fail or roll back
   * the caller (delivery completion / DO + invoice creation). Idempotent via the
   * @@unique(userId, kind, entityId) index + skipDuplicates, so a re-fired
   * completion is a silent no-op rather than a duplicate bell.
   */
  async emit(params: EmitNotificationParams): Promise<void> {
    try {
      const recipients = await this.resolveRecipients(params.organizationId);
      if (!recipients.length) return;
      await this.prisma.notification.createMany({
        data: recipients.map((userId) => ({
          organizationId: params.organizationId,
          userId,
          kind: params.kind,
          title: params.title,
          body: params.body ?? null,
          entityType: params.entityType ?? null,
          entityId: params.entityId ?? null,
          linkUrl: params.linkUrl ?? null,
        })),
        skipDuplicates: true,
      });
    } catch (err: any) {
      this.logger.error(
        `notification emit failed (${params.kind} ${params.entityId ?? ''}): ${err?.message}`,
      );
    }
  }

  /** Office users of the org = holders of `documents:read` (field-tech lack it). */
  private async resolveRecipients(organizationId: string): Promise<string[]> {
    const rows = await this.prisma.userRole.findMany({
      where: {
        organizationId,
        isActive: true,
        role: { permissions: { some: { name: 'documents:read' } } },
      },
      select: { userId: true },
    });
    return [...new Set(rows.map((r) => r.userId))];
  }

  /** The caller's own notifications in the active org, newest first, + unread count. */
  async list(userId: string, organizationId: string, limit = 20) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId, organizationId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.notification.count({
        where: { userId, organizationId, readAt: null },
      }),
    ]);
    return { items, unread };
  }

  /** Mark one of the caller's own notifications read (scoped to user + org). */
  async markRead(id: string, userId: string, organizationId: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId, organizationId, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true };
  }

  /** Mark all of the caller's unread notifications read. */
  async markAllRead(userId: string, organizationId: string) {
    const r = await this.prisma.notification.updateMany({
      where: { userId, organizationId, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true, updated: r.count };
  }
}
