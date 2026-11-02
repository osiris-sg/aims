import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ClerkClient } from '@clerk/backend';
import { PrismaService } from '../common/prisma.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { AdminActor, PLATFORM_ADMIN_ROLE_WHERE } from '../auth/admin-scope';
import { acceptPendingInvites, DEFAULT_MEMBERSHIP_ORDER, isEmail, normEmail, NOT_A_MEMBER_MESSAGE } from '../auth/active-org';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';

const portalUrl = () => (process.env.PORTAL_URL || 'https://app.ai-ms.io').replace(/\/+$/, '');

/** The one answer "Add existing user by email" ever gives: it never says whether the email has a login or belongs to another org. */
export const ADD_MEMBER_REPLY = (email: string, org: string) => `Done. ${email} now has access to ${org}, or has been sent an invitation to join. They will get an email.`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Multi-organisation users (2026-11-02): the caller's own memberships and org
 * switch, and an org admin's "Add existing user by email" / invitations for
 * their OWN org. See src/auth/active-org.ts for the request-side rules.
 */
@Injectable()
export class MembershipsService {
  private readonly logger = new Logger(MembershipsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('ClerkClient') private readonly clerkClient: ClerkClient,
    @Optional() private readonly email?: EmailService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  // ── the caller ────────────────────────────────────────────────────────────

  /** My active organisations (default first), with my roles and unread bell count in each. */
  async myOrganizations(userId: string, emails: string[], current: { id: string } | null, isOsirisAdmin: boolean) {
    // An invitation accepted after the person already had another org.
    if (emails.length && (await acceptPendingInvites(this.prisma, userId, emails))) ClerkAuthGuard.invalidateUser(userId);
    const rows = await this.prisma.userOrganization.findMany({
      where: { userId, isActive: true },
      orderBy: DEFAULT_MEMBERSHIP_ORDER as any,
      select: { organizationId: true, lastActiveAt: true, organization: { select: { id: true, name: true, logo: true } } },
    });
    const ids = rows.map((r) => r.organizationId);
    const [roles, unread] = await Promise.all([
      ids.length ? this.prisma.userRole.findMany({ where: { userId, isActive: true, organizationId: { in: ids } }, select: { organizationId: true, role: { select: { name: true } } } }) : [],
      ids.length ? this.prisma.notification.groupBy({ by: ['organizationId'], where: { userId, readAt: null, organizationId: { in: ids } }, _count: { _all: true } }) : [],
    ]);
    const unreadBy = new Map((unread as any[]).map((u) => [u.organizationId, u._count._all]));
    return {
      isOsirisAdmin,
      currentOrganizationId: current?.id ?? null,
      defaultOrganizationId: rows[0]?.organizationId ?? null,
      organizations: rows
        .filter((r) => r.organization)
        .map((r) => ({
          id: r.organization.id,
          name: r.organization.name,
          logo: r.organization.logo ?? null,
          roles: (roles as any[])
            .filter((x) => x.organizationId === r.organizationId)
            .map((x) => x.role?.name)
            .filter(Boolean),
          unreadNotifications: unreadBy.get(r.organizationId) ?? 0,
          lastActiveAt: r.lastActiveAt,
        })),
    };
  }

  /** Switch: remember the org as my default (most recently used). Members only; an osiris admin's switch to an org they don't belong to is accepted and not remembered. */
  async setActiveOrg(userId: string, organizationId: string, isOsirisAdmin: boolean) {
    if (!organizationId) throw new BadRequestException('organizationId is required');
    const m = await this.prisma.userOrganization.updateMany({ where: { userId, organizationId, isActive: true }, data: { lastActiveAt: new Date() } });
    if (!m.count && !isOsirisAdmin) throw new ForbiddenException(NOT_A_MEMBER_MESSAGE);
    ClerkAuthGuard.invalidateUser(userId);
    return { organizationId, remembered: m.count > 0 };
  }

  // ── an org admin, for their own org ───────────────────────────────────────

  /**
   * "Add existing user by email". A login with that email becomes a member of
   * the caller's org with the roles given (no consent step; they get an in-app
   * notice and an email). No login: an invitation (Clerk emails the sign-up
   * link; the membership is made on their first sign-in). Either way, and when
   * it can't be done (a platform admin's login), the reply is the same text,
   * so it never tells the caller whether the email exists or is in another org.
   */
  async addByEmail(rawEmail: string, roleIds: string[], actor: AdminActor & { name?: string }) {
    const email = normEmail(rawEmail);
    if (!isEmail(email)) throw new BadRequestException('Enter a valid email address');
    const organizationId = actor.orgId;
    const ids = [...new Set((roleIds || []).filter(Boolean))];
    if (!ids.length) throw new BadRequestException('Pick at least one role');
    const roles = await this.prisma.role.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, name: true } });
    if (roles.length !== ids.length) throw new NotFoundException('One of the roles is not in this organisation');
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } });
    if (!org) throw new NotFoundException('Organisation not found');
    const reply = { ok: true, message: ADD_MEMBER_REPLY(email, org.name) };

    const login = await this.findLogin(email);
    if (login) {
      const userId = login.externalId || login.id;
      const platform = await this.prisma.userRole.count({ where: { userId, isActive: true, ...PLATFORM_ADMIN_ROLE_WHERE } });
      if (platform) {
        this.logger.log(`addByEmail: ${org.name} tried a platform admin's login; nothing changed`);
        return reply;
      }
      const before = await this.prisma.userOrganization.findUnique({ where: { userId_organizationId: { userId, organizationId } } });
      await this.prisma.userOrganization.upsert({
        where: { userId_organizationId: { userId, organizationId } },
        update: { isActive: true },
        create: { userId, organizationId, isActive: true },
      });
      for (const r of roles) {
        await this.prisma.userRole.upsert({
          where: { userId_roleId_organizationId: { userId, roleId: r.id, organizationId } },
          update: { isActive: true },
          create: { userId, roleId: r.id, organizationId },
        });
      }
      ClerkAuthGuard.invalidateUser(userId);
      if (!before?.isActive)
        await this.tellAdded(
          userId,
          email,
          org,
          roles.map((r) => r.name),
          actor.name,
        );
      return reply;
    }

    // No login yet: one open invitation per (org, email); a re-invite refreshes it.
    let clerkInvitationId: string | null = null;
    try {
      const inv: any = await (this.clerkClient as any).invitations.createInvitation({
        emailAddress: email,
        redirectUrl: `${portalUrl()}/sign-up`,
        ignoreExisting: true,
        notify: true,
      });
      clerkInvitationId = inv?.id ?? null;
    } catch (e: any) {
      // An invitation already pending in Clerk is fine; anything else is a real failure.
      const code = e?.errors?.[0]?.code ?? '';
      if (!/duplicate|already/i.test(`${code} ${e?.message ?? ''}`)) {
        this.logger.error(`addByEmail: Clerk invitation failed: ${e?.message}`);
        throw new BadRequestException('The invitation could not be sent. Please try again.');
      }
    }
    await this.prisma.pendingOrgInvite.upsert({
      where: { organizationId_email: { organizationId, email } },
      update: {
        roleIds: ids,
        invitedById: actor.userId ?? null,
        invitedByName: actor.name ?? null,
        acceptedAt: null,
        acceptedUserId: null,
        revokedAt: null,
        ...(clerkInvitationId ? { clerkInvitationId } : {}),
      },
      create: { organizationId, email, roleIds: ids, invitedById: actor.userId ?? null, invitedByName: actor.name ?? null, clerkInvitationId },
    });
    return reply;
  }

  /** The caller's org's open invitations (shown as "Invited" in User Management). */
  async listInvites(organizationId: string) {
    const rows = await this.prisma.pendingOrgInvite.findMany({ where: { organizationId, acceptedAt: null, revokedAt: null }, orderBy: { createdAt: 'desc' } });
    const roleIds = [...new Set(rows.flatMap((r) => r.roleIds))];
    const roles = roleIds.length ? await this.prisma.role.findMany({ where: { id: { in: roleIds }, organizationId }, select: { id: true, name: true } }) : [];
    const name = new Map(roles.map((r) => [r.id, r.name]));
    return rows.map((r) => ({ id: r.id, email: r.email, roles: r.roleIds.map((id) => name.get(id)).filter(Boolean), invitedByName: r.invitedByName, createdAt: r.createdAt }));
  }

  /** Cancel an open invitation of the caller's org. */
  async revokeInvite(organizationId: string, id: string) {
    const inv = await this.prisma.pendingOrgInvite.findFirst({ where: { id, organizationId, acceptedAt: null, revokedAt: null } });
    if (!inv) throw new NotFoundException('Invitation not found');
    await this.prisma.pendingOrgInvite.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
    if (inv.clerkInvitationId) {
      await (this.clerkClient as any).invitations.revokeInvitation(inv.clerkInvitationId).catch((e: any) => this.logger.warn(`revokeInvitation: ${e?.message}`));
    }
    return { ok: true };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async findLogin(email: string): Promise<{ id: string; externalId?: string | null } | null> {
    const found: any = await this.clerkClient.users.getUserList({ emailAddress: [email] });
    const list = Array.isArray(found) ? found : (found?.data ?? []);
    return list[0] ?? null;
  }

  /** The in-app notice (in the org they were added to; the switcher shows its unread count) and the email. Best-effort. */
  private async tellAdded(userId: string, email: string, org: { id: string; name: string }, roleNames: string[], byName?: string) {
    const who = byName ? `${byName} added you` : 'You were added';
    const roles = roleNames.length ? ` as ${roleNames.join(', ')}` : '';
    await this.notifications
      ?.emit({
        organizationId: org.id,
        kind: 'member_added',
        title: `You now have access to ${org.name}`,
        body: `${who} to ${org.name}${roles}. Switch organisation from the menu at the top.`,
        entityType: 'Organization',
        entityId: `${org.id}:${userId}`,
        forUserId: userId,
        exclusive: true,
      })
      .catch(() => undefined);
    const res = await this.email
      ?.sendSimpleEmail({
        to: [email],
        subject: `You now have access to ${org.name} on AIMS`,
        html: `<p>${esc(who)} to <b>${esc(org.name)}</b> on AIMS${esc(roles)}.</p><p>Sign in at <a href="${portalUrl()}">${portalUrl().replace(/^https?:\/\//, '')}</a> with this email, then pick <b>${esc(org.name)}</b> from the organisation menu at the top.</p>`,
      })
      .catch((e: any) => ({ success: false, error: e?.message }));
    if (res && !res.success) this.logger.warn(`member-added email to ${userId} not sent: ${res.error}`);
  }
}
