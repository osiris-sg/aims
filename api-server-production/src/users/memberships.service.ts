import { BadRequestException, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { ClerkClient } from '@clerk/backend';
import { PrismaService } from '../common/prisma.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { AdminActor, PLATFORM_ADMIN_ROLE_WHERE } from '../auth/admin-scope';
import { DEFAULT_MEMBERSHIP_ORDER, isEmail, normEmail, NOT_A_MEMBER_MESSAGE } from '../auth/active-org';
import { ClerkIdentityService } from '../clerk/clerk-identity.service';
import { EmailService } from '../email/email.service';
import { ActionLogService } from '../action-log/action-log.service';

/** The one success text "Add user" ever gives: the same whether the email already had a login (in any org) or not. */
export const ADD_MEMBER_REPLY = (email: string, org: string) => `${email} has been added to ${org}. They'll get an email to set their password, or can sign in with Google/phone if set up.`;

/** How long the "set your password" link in a new login's welcome email works. */
export const SET_PASSWORD_LINK_SECONDS = 7 * 24 * 3600;

const portalOrigin = () => (process.env.PORTAL_URL || process.env.FRONTEND_URL || 'https://app.ai-ms.io').replace(/\/+$/, '');
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The welcome email a NEW login gets: a one-time link that signs them in and asks for a password. */
export function setPasswordEmail(org: string, link: string) {
  const signIn = `${portalOrigin()}/sign-in`;
  return {
    subject: `Set your AIMS password`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;max-width:520px">
<p>You have been added to <b>${esc(org)}</b> on AIMS.</p>
<p>Choose a password to sign in:</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px">Set your password</a></p>
<p style="color:#6b7280;font-size:12px">This link works once and expires in 7 days. If it has expired, use "Forgot password" on <a href="${esc(signIn)}">${esc(signIn)}</a> with this email address.</p>
</div>`,
  };
}

/** The one error text for anything that stops "Add user" after the form checks (it never says why). */
export const ADD_MEMBER_FAILED = 'This person could not be added. Check the email address and try again.';

/**
 * Multi-organisation users (2026-11-02): the caller's own memberships and org
 * switch, and an org admin's "Add user" (email + role) for their OWN org. See
 * src/auth/active-org.ts for the request-side rules.
 *
 * "Add user" (owner 2026-11-02: no invitations, no emails, no accept step):
 *   - a login with that email (whatever org it is in) becomes a member of the
 *     caller's org with the role(s), at once;
 *   - no login: the login is created for that email the way User Management
 *     creates users (Clerk user, external_id stamped), then the membership,
 *     and (owner 2026-11-03) the person gets a "set your password" email: a
 *     one-time Clerk sign-in link to /set-password, sent by AIMS (Resend);
 *   - an existing login is sent nothing; the org simply appears in their picker;
 *   - the caller gets the SAME reply either way, and one error wording for
 *     anything that can't be done, so nothing tells them whether the login
 *     existed or which other orgs it belongs to.
 */
@Injectable()
export class MembershipsService {
  private readonly logger = new Logger(MembershipsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('ClerkClient') private readonly clerkClient: ClerkClient,
    private readonly clerkIdentity: ClerkIdentityService,
    private readonly email: EmailService,
    private readonly actionLog: ActionLogService,
  ) {}

  // ── the caller ────────────────────────────────────────────────────────────

  /** My active organisations (default first), with my roles and unread bell count in each. */
  async myOrganizations(userId: string, current: { id: string } | null, isOsirisAdmin: boolean) {
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

  /** "Add user": email + role(s), into the caller's org. See the class comment. */
  async addByEmail(rawEmail: string, roleIds: string[], actor: AdminActor) {
    const email = normEmail(rawEmail);
    if (!isEmail(email)) throw new BadRequestException('Enter a valid email address');
    const organizationId = actor.orgId;
    const ids = [...new Set((roleIds || []).filter(Boolean))];
    if (!ids.length) throw new BadRequestException('Pick at least one role');
    const roles = await this.prisma.role.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true } });
    if (roles.length !== ids.length) throw new BadRequestException('Pick roles of this organisation');
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } });
    if (!org) throw new BadRequestException(ADD_MEMBER_FAILED);

    let userId: string;
    let created = false;
    try {
      const existing = await this.existingLogin(email);
      userId = existing ?? (await this.createLogin(email));
      created = !existing;
    } catch (e: any) {
      this.logger.error(`addByEmail: login lookup / create failed: ${e?.message}`);
      throw new BadRequestException(ADD_MEMBER_FAILED);
    }
    // A platform admin's login is never added to an org this way.
    if (await this.prisma.userRole.count({ where: { userId, isActive: true, ...PLATFORM_ADMIN_ROLE_WHERE } })) throw new BadRequestException(ADD_MEMBER_FAILED);

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
    if (created) await this.sendSetPasswordEmail(email, userId, org.name);
    return { ok: true, message: ADD_MEMBER_REPLY(email, org.name) };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** The AIMS id of the login with this email, if there is one (an imported user's id is its external_id). */
  private async existingLogin(email: string): Promise<string | null> {
    const found: any = await this.clerkClient.users.getUserList({ emailAddress: [email] });
    const u = (Array.isArray(found) ? found : (found?.data ?? []))[0];
    return u ? u.externalId || u.id : null;
  }

  /**
   * The new login's welcome email. Never fails "Add user" (the reply must not
   * differ): a failure is logged as a platform-only System row (no org, so the
   * org's own Activity Log never shows whether the login was new).
   */
  private async sendSetPasswordEmail(email: string, userId: string, orgName: string) {
    let error: string | undefined;
    try {
      const t: any = await this.clerkClient.signInTokens.createSignInToken({ userId, expiresInSeconds: SET_PASSWORD_LINK_SECONDS });
      const link = `${portalOrigin()}/set-password?ticket=${encodeURIComponent(t.token)}`;
      const r = await this.email.sendSimpleEmail({ to: [email], ...setPasswordEmail(orgName, link) });
      if (!r.success) error = r.error || 'send failed';
    } catch (e: any) {
      error = e?.message || String(e);
    }
    if (error) this.logger.error(`addByEmail: set-password email for ${userId} failed: ${error}`);
    this.actionLog.system('add-user-welcome-email', error ? 'EMAIL_FAILED' : 'EMAIL_SENT', 'user', {
      resourceId: userId,
      status: error ? 'FAILURE' : 'SUCCESS',
      details: error ? { error } : undefined,
    });
  }

  /** A new login for the email, made as UsersService.createUser makes one (no password; external_id = own id). */
  private async createLogin(email: string): Promise<string> {
    const u = await this.clerkClient.users.createUser({ emailAddress: [email], skipPasswordChecks: true, skipPasswordRequirement: true } as any);
    await this.clerkIdentity.stampExternalId(u.id);
    return u.id;
  }
}
