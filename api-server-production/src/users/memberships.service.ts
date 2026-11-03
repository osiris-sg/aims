import { BadRequestException, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { ClerkClient } from '@clerk/backend';
import { PrismaService } from '../common/prisma.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { AdminActor, PLATFORM_ADMIN_ROLE_WHERE } from '../auth/admin-scope';
import { DEFAULT_MEMBERSHIP_ORDER, isEmail, normEmail, NOT_A_MEMBER_MESSAGE } from '../auth/active-org';
import { ClerkIdentityService } from '../clerk/clerk-identity.service';
import { EmailService } from '../email/email.service';
import { ActionLogService } from '../action-log/action-log.service';

/** What the Add user form sends (owner 2026-11-03: email and/or SG mobile, names, roles, optional password). */
export type AddMemberInput = {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  password?: string | null;
  roleIds?: string[];
  // This org's membership (the drawer's Salesman Code / Salesman Mobile), not the login.
  salesmanCode?: string | null;
  salesmanMobile?: string | null;
};

/** A Singapore mobile as E.164 (+65 then 8 digits starting with 8 or 9), or null. Spaces, dashes and a leading +65 / 65 are fine. */
export const normSgMobile = (raw: unknown): string | null => {
  const d = String(raw ?? '').replace(/[\s\-().]/g, '');
  const m = d.match(/^(?:\+?65)?([89]\d{7})$/);
  return m ? `+65${m[1]}` : null;
};

/** +6591234567 as "+65 9123 4567". */
export const prettySgMobile = (e164: string) => `+65 ${e164.slice(3, 7)} ${e164.slice(7)}`;

/** Who was added, as the admin typed it: "a@b.sg (+65 9123 4567)", or whichever one was entered. */
export const memberLabel = (email: string | null, phone: string | null) => (email && phone ? `${email} (${prettySgMobile(phone)})` : email || (phone ? prettySgMobile(phone) : ''));

/** The one success text "Add user" ever gives: the same whether a login already existed (in any org) or not. */
export const ADD_MEMBER_REPLY = (who: string, org: string) => `${who} has been added to ${org}. They can sign in at app.ai-ms.io with their email or mobile.`;

/** The one error text for anything that stops "Add user" after the form checks (it never says why). */
export const ADD_MEMBER_FAILED = 'This person could not be added. Check the email address and try again.';

/** How long the "set your password" link in a new login's welcome email works. */
export const SET_PASSWORD_LINK_SECONDS = 7 * 24 * 3600;

/** Clerk private metadata on a login whose password an admin set at Add user: it may be replaced once at /set-password without the current one. */
export const ADMIN_SET_PASSWORD_FLAG = 'aimsPasswordSetByAdmin';

const portalOrigin = () => (process.env.PORTAL_URL || process.env.FRONTEND_URL || 'https://app.ai-ms.io').replace(/\/+$/, '');
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The welcome email a NEW login with an email gets: a one-time link that signs them in and asks for a password. */
export function setPasswordEmail(org: string, link: string, opts: { adminSetPassword?: boolean } = {}) {
  const signIn = `${portalOrigin()}/sign-in`;
  const lead = opts.adminSetPassword ? '<p>Your admin has set a password for you. You can sign in with it, or choose your own using this link.</p>' : '<p>Choose a password to sign in:</p>';
  return {
    subject: `Set your AIMS password`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;max-width:520px">
<p>You have been added to <b>${esc(org)}</b> on AIMS.</p>
${lead}
<p><a href="${esc(link)}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px">Set your password</a></p>
<p style="color:#6b7280;font-size:12px">This link works once and expires in 7 days. If it has expired, use "Forgot password" on <a href="${esc(signIn)}">${esc(signIn)}</a> with this email address.</p>
</div>`,
  };
}

const listOf = (found: any): any[] => (Array.isArray(found) ? found : (found?.data ?? []));

/**
 * Multi-organisation users (2026-11-02): the caller's own memberships and org
 * switch, and an org admin's "Add user" for their OWN org. See
 * src/auth/active-org.ts for the request-side rules.
 *
 * "Add user" (owner 2026-11-03: the full form, the identical-response rule kept):
 *   - email and/or SG mobile (at least one), first / last name, role(s), an
 *     optional password;
 *   - a login matching the email or the phone (whatever org it is in) becomes
 *     a member of the caller's org with the role(s), at once. Nothing about
 *     that login is changed (name, password, email, phone) and nothing is
 *     sent. Email and phone matching two DIFFERENT logins is refused;
 *   - no login: one is made with what was typed, then the membership. With an
 *     email it ALWAYS gets the "Set your AIMS password" email (a one-time
 *     Clerk sign-in link to /set-password, sent by AIMS via Resend), worded
 *     for an admin-set password when one was given. Phone only: nothing is
 *     sent, they sign in with an SMS code;
 *   - the caller gets the SAME reply every way, and one error wording for
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

  /** "Add user" into the caller's org. See the class comment. */
  async addMember(input: AddMemberInput, actor: AdminActor) {
    const rawEmail = String(input?.email ?? '').trim();
    const rawPhone = String(input?.phone ?? '').trim();
    if (!rawEmail && !rawPhone) throw new BadRequestException('Enter an email or a mobile number');
    const email = rawEmail ? normEmail(rawEmail) : null;
    if (email && !isEmail(email)) throw new BadRequestException('Enter a valid email address');
    const phone = rawPhone ? normSgMobile(rawPhone) : null;
    if (rawPhone && !phone) throw new BadRequestException('Enter a Singapore mobile number: 8 digits starting with 8 or 9');
    const password = input?.password ? String(input.password) : null;
    if (password && password.length < 8) throw new BadRequestException('The password must be at least 8 characters');
    const firstName = String(input?.firstName ?? '').trim() || undefined;
    const lastName = String(input?.lastName ?? '').trim() || undefined;

    const organizationId = actor.orgId;
    const ids = [...new Set((input?.roleIds || []).filter(Boolean))];
    if (!ids.length) throw new BadRequestException('Pick at least one role');
    const roles = await this.prisma.role.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true } });
    if (roles.length !== ids.length) throw new BadRequestException('Pick roles of this organisation');
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } });
    if (!org) throw new BadRequestException(ADD_MEMBER_FAILED);

    let userId: string;
    let created = false;
    try {
      const existing = await this.existingLogin(email, phone);
      if (existing === 'conflict') throw new Error('email and phone belong to different logins');
      userId = existing ?? (await this.createLogin({ email, phone, firstName, lastName, password }));
      created = !existing;
    } catch (e: any) {
      this.logger.error(`addMember: login lookup / create failed: ${e?.message}`);
      throw new BadRequestException(ADD_MEMBER_FAILED);
    }
    // A platform admin's login is never added to an org this way.
    if (await this.prisma.userRole.count({ where: { userId, isActive: true, ...PLATFORM_ADMIN_ROLE_WHERE } })) throw new BadRequestException(ADD_MEMBER_FAILED);

    // Salesman code / mobile belong to THIS org's membership (not the login): set when given.
    const salesmanCode = String(input?.salesmanCode ?? '').trim() || undefined;
    const salesmanMobile = String(input?.salesmanMobile ?? '').trim() || undefined;
    await this.prisma.userOrganization.upsert({
      where: { userId_organizationId: { userId, organizationId } },
      update: { isActive: true, salesmanCode, salesmanMobile },
      create: { userId, organizationId, isActive: true, salesmanCode: salesmanCode ?? null, salesmanMobile: salesmanMobile ?? null },
    });
    for (const r of roles) {
      await this.prisma.userRole.upsert({
        where: { userId_roleId_organizationId: { userId, roleId: r.id, organizationId } },
        update: { isActive: true },
        create: { userId, roleId: r.id, organizationId },
      });
    }
    ClerkAuthGuard.invalidateUser(userId);
    if (created && email) await this.sendSetPasswordEmail(email, userId, org.name, !!password);
    return { ok: true, message: ADD_MEMBER_REPLY(memberLabel(email, phone), org.name) };
  }

  /** The old email-only call (kept for the old path). */
  addByEmail(email: string, roleIds: string[], actor: AdminActor) {
    return this.addMember({ email, roleIds }, actor);
  }

  /**
   * /set-password for a login whose password an admin set at Add user: the
   * person replaces it once without the current one (Clerk asks for the
   * current password otherwise). Then the flag is cleared; after that it is
   * "Forgot password" like everyone else.
   */
  async setFirstPassword(userId: string, newPassword: string) {
    if (!newPassword || String(newPassword).length < 8) throw new BadRequestException('Use at least 8 characters.');
    const u: any = await this.clerkIdentity.toClerkUser(userId, { fresh: true });
    if (u?.privateMetadata?.[ADMIN_SET_PASSWORD_FLAG] !== true) throw new ForbiddenException('To change your password, use "Forgot password" on the sign-in page.');
    try {
      await this.clerkClient.users.updateUser(u.id, { password: String(newPassword), skipPasswordChecks: true, signOutOfOtherSessions: false } as any);
    } catch (e: any) {
      const c = e?.errors?.[0];
      throw new BadRequestException(c?.longMessage || c?.message || 'The password could not be saved. Please try again.');
    }
    await this.clerkClient.users.updateUserMetadata(u.id, { privateMetadata: { [ADMIN_SET_PASSWORD_FLAG]: null } });
    this.clerkIdentity.invalidate(userId);
    return { ok: true };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * The AIMS id of the login with this email or phone (an imported user's id
   * is its external_id), null if none, 'conflict' if the email and the phone
   * belong to two different logins.
   */
  private async existingLogin(email: string | null, phone: string | null): Promise<string | null | 'conflict'> {
    const byEmail = email ? listOf(await this.clerkClient.users.getUserList({ emailAddress: [email] }))[0] : undefined;
    const byPhone = phone ? listOf(await this.clerkClient.users.getUserList({ phoneNumber: [phone] }))[0] : undefined;
    if (byEmail && byPhone && byEmail.id !== byPhone.id) return 'conflict';
    const u = byEmail ?? byPhone;
    return u ? u.externalId || u.id : null;
  }

  /**
   * The new login's welcome email. Never fails "Add user" (the reply must not
   * differ): a failure is logged as a platform-only System row (no org, so the
   * org's own Activity Log never shows whether the login was new).
   */
  private async sendSetPasswordEmail(email: string, userId: string, orgName: string, adminSetPassword: boolean) {
    let error: string | undefined;
    let messageId: string | undefined;
    try {
      const t: any = await this.clerkClient.signInTokens.createSignInToken({ userId, expiresInSeconds: SET_PASSWORD_LINK_SECONDS });
      const link = `${portalOrigin()}/set-password?ticket=${encodeURIComponent(t.token)}`;
      const r = await this.email.sendSimpleEmail({ to: [email], ...setPasswordEmail(orgName, link, { adminSetPassword }) });
      if (!r.success) error = r.error || 'send failed';
      messageId = r.messageId;
    } catch (e: any) {
      error = e?.message || String(e);
    }
    if (error) this.logger.error(`addMember: set-password email for ${userId} failed: ${error}`);
    this.actionLog.system('add-user-welcome-email', error ? 'EMAIL_FAILED' : 'EMAIL_SENT', 'user', {
      resourceId: userId,
      status: error ? 'FAILURE' : 'SUCCESS',
      // The Resend message id, so delivery can be looked up in Resend.
      details: error ? { error } : { messageId },
    });
  }

  /** A new login made from the form (external_id = own id). Admin-set identifiers are verified; a given password is flagged as admin-set. */
  private async createLogin(p: { email: string | null; phone: string | null; firstName?: string; lastName?: string; password: string | null }): Promise<string> {
    const u = await this.clerkClient.users.createUser({
      ...(p.email ? { emailAddress: [p.email] } : {}),
      ...(p.phone ? { phoneNumber: [p.phone] } : {}),
      ...(p.firstName ? { firstName: p.firstName } : {}),
      ...(p.lastName ? { lastName: p.lastName } : {}),
      ...(p.password ? { password: p.password, privateMetadata: { [ADMIN_SET_PASSWORD_FLAG]: true } } : {}),
      skipPasswordChecks: true,
      skipPasswordRequirement: true,
    } as any);
    await this.clerkIdentity.stampExternalId(u.id);
    return u.id;
  }
}
