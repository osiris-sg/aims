import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { MODULE_CATALOG } from 'src/configuration/module-catalog';

export interface EmitNotificationParams {
  organizationId: string;
  kind: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  linkUrl?: string | null;
  /** The user this notification is ABOUT (e.g. the designer a lead was
   *  assigned to). They receive it even if they are designer-only. */
  forUserId?: string | null;
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
      const recipients = await this.resolveRecipients(params.organizationId, params.forUserId ?? null, params.linkUrl ?? null);
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

  /**
   * Recipients for an org's notifications:
   *  - Office users OF THE ORG: holders of `documents:read` (field-tech lack it).
   *  - Global osirisadmins (any org): they oversee every org and view-as it, so
   *    the row is written with THIS org's id and only surfaces in their bell while
   *    they are viewing this org (the bell query filters by active org). Without
   *    this, a global admin who has no membership in the org — e.g. admin@osiris.sg
   *    completing a test delivery viewing-as the org — would never see the bell,
   *    even though the org's own staff do. Per-user read state is preserved.
   */
  /** The module a portal link belongs to, by longest route-prefix match
   *  against MODULE_CATALOG (e.g. /portal/sales/leads → SALES). null when the
   *  link matches no module (or there is no link) — then no module gate. */
  private moduleForLink(linkUrl: string | null): string | null {
    if (!linkUrl) return null;
    let best: { code: string; len: number } | null = null;
    for (const m of MODULE_CATALOG) {
      const route = (m as any).config?.route;
      if (!route || route === '/portal') continue; // dashboard prefix matches everything
      if (linkUrl === route || linkUrl.startsWith(route + '/')) {
        if (!best || route.length > best.len) best = { code: m.moduleCode, len: route.length };
      }
    }
    return best?.code || null;
  }

  private async resolveRecipients(organizationId: string, forUserId: string | null = null, linkUrl: string | null = null): Promise<string[]> {
    const [orgReaders, osirisAdmins, allRoles] = await Promise.all([
      this.prisma.userRole.findMany({
        where: {
          organizationId,
          isActive: true,
          role: { permissions: { some: { name: 'documents:read' } } },
        },
        select: { userId: true },
      }),
      this.prisma.userRole.findMany({
        where: { isActive: true, role: { name: 'osirisadmin' } },
        select: { userId: true },
      }),
      this.prisma.userRole.findMany({
        where: { organizationId, isActive: true },
        select: { userId: true, role: { select: { name: true, allowedModules: true } } },
      }),
    ]);
    // A user only receives notifications they are ALLOWED TO SEE
    // (guru 2026-09-19, all orgs):
    //  1. Designer-only users get ONLY notifications addressed to them
    //     (forUserId) — org-wide "master control" traffic stays with management.
    //  2. Everyone else is additionally gated by their roles' allowedModules:
    //     a notification linking into a module their sidebar hides (e.g. a
    //     projects alert for a role without PROJECTS) is not delivered.
    //     Same semantics as the sidebar: no roles or any role with an empty
    //     allowedModules list = every module.
    const rolesByUser = new Map<string, Array<{ name: string; allowedModules: string[] }>>();
    for (const r of allRoles) {
      const list = rolesByUser.get(r.userId) || [];
      list.push({ name: r.role.name, allowedModules: (r.role as any).allowedModules || [] });
      rolesByUser.set(r.userId, list);
    }
    const designerOnly = (userId: string) => {
      const roles = rolesByUser.get(userId) || [];
      return roles.length > 0 && roles.every((r) => r.name === 'Designer');
    };
    const requiredModule = this.moduleForLink(linkUrl);
    const moduleAllowed = (userId: string) => {
      if (!requiredModule) return true;
      const roles = rolesByUser.get(userId) || [];
      if (roles.length === 0) return true; // e.g. osirisadmin with no org roles
      if (roles.some((r) => r.allowedModules.length === 0)) return true;
      return roles.flatMap((r) => r.allowedModules).includes(requiredModule);
    };
    const base = [...new Set([...orgReaders, ...osirisAdmins].map((r) => r.userId))].filter(
      (u) => u === forUserId || (!designerOnly(u) && moduleAllowed(u)),
    );
    if (forUserId && !base.includes(forUserId)) base.push(forUserId);
    return base;
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
