import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { OperatorChannel, OperatorContext } from './operator.types';

/** Flat (not a discriminated union) — this project runs strictNullChecks:false,
 *  which disables union narrowing, so callers check `ok` and read the fields. */
export interface ResolveResult {
  ok: boolean;
  ctx?: OperatorContext;
  reason?: 'unlinked' | 'no-org' | 'needs-org-choice';
  options?: Array<{ id: string; name: string }>;
}

/**
 * Identity + permission resolution for chat senders.
 *
 * AIMS has no User model — identity is Clerk-only and `UserRole.userId` /
 * `UserOrganization.userId` hold raw Clerk ids. So a chat sender must be
 * explicitly linked to a Clerk user id (OperatorIdentity) before we act.
 *
 * ClerkAuthGuard.loadUserAuth is private, so the two lookups it performs are
 * replicated here (kept uncached deliberately: the guard's cache is private and
 * static, and a second cache would not be flushed by its invalidateUser calls).
 */
@Injectable()
export class OperatorAuthService {
  private readonly logger = new Logger(OperatorAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Linking ────────────────────────────────────────────────────────────────

  /** Portal-side: mint a short-lived code the user texts to the bot. */
  async createLinkCode(clerkUserId: string, ttlMinutes = 10) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    await this.prisma.operatorLinkCode.create({ data: { code, clerkUserId, expiresAt } });
    return { code, expiresAt };
  }

  /** Bot-side: `/link 123456` — bind this sender to the code's Clerk user. */
  async redeemLinkCode(
    channel: OperatorChannel,
    channelUserId: string,
    code: string,
    displayName?: string,
  ): Promise<{ ok: boolean; message: string }> {
    const row = await this.prisma.operatorLinkCode.findUnique({ where: { code: code.trim() } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      return { ok: false, message: 'That code is invalid or has expired. Generate a new one in AIMS → Settings.' };
    }
    await this.prisma.$transaction([
      this.prisma.operatorLinkCode.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.prisma.operatorIdentity.upsert({
        where: { channel_channelUserId: { channel, channelUserId } },
        update: { clerkUserId: row.clerkUserId, verified: true, displayName, lastSeenAt: new Date() },
        create: { channel, channelUserId, clerkUserId: row.clerkUserId, verified: true, displayName },
      }),
    ]);
    return { ok: true, message: 'Linked. You can now ask me to work in AIMS.' };
  }

  async unlink(channel: OperatorChannel, channelUserId: string) {
    await this.prisma.operatorIdentity
      .delete({ where: { channel_channelUserId: { channel, channelUserId } } })
      .catch(() => null);
  }

  // ── Per-message resolution ────────────────────────────────────────────────

  /**
   * Resolve a sender into an org-scoped context.
   * Returns `{ needsOrgChoice }` when the user belongs to several orgs and
   * hasn't picked one — the caller asks and then calls setOrganization().
   */
  /** Cheap routing gate: does a linked operator identity exist for this sender?
   *  Used by channels (e.g. WhatsApp) that must decide operator-vs-other before
   *  running the full resolve(). */
  async isLinked(channel: OperatorChannel, channelUserId: string): Promise<boolean> {
    const id = await this.prisma.operatorIdentity.findUnique({
      where: { channel_channelUserId: { channel, channelUserId } },
      select: { id: true },
    });
    if (id) return true;
    // Also recognised: a WhatsApp number an admin set on a user's member profile
    // (User Management → WhatsApp number). Cheap — whatsappNumber is indexed.
    if (channel === 'whatsapp') {
      const digits = String(channelUserId).replace(/\D/g, '');
      if (!digits) return false;
      const prof = await this.prisma.organizationMemberProfile.findFirst({
        where: { whatsappNumber: digits },
        select: { id: true },
      });
      return !!prof;
    }
    return false;
  }

  async resolve(channel: OperatorChannel, channelUserId: string): Promise<ResolveResult> {
    // 1) Explicit link — OperatorIdentity (/link flow, osirisadmin, manual register).
    const identity = await this.prisma.operatorIdentity.findUnique({
      where: { channel_channelUserId: { channel, channelUserId } },
    });
    if (identity?.verified) {
      return this.resolveForUser(identity.clerkUserId, identity.organizationId, channel, channelUserId, {
        displayName: identity.displayName,
        identityId: identity.id,
      });
    }

    // 2) Self-serve link — a WhatsApp number an admin set on the user's member
    //    profile (User Management → WhatsApp number). No manual registration.
    if (channel === 'whatsapp') {
      const digits = String(channelUserId).replace(/\D/g, '');
      if (digits) {
        const profiles = await this.prisma.organizationMemberProfile.findMany({
          where: { whatsappNumber: digits },
          select: { userId: true, organizationId: true },
        });
        const users = [...new Set(profiles.map((p) => p.userId))];
        if (users.length === 1) {
          // One person. If the number is on exactly one org's profile, use that
          // org; if on several, let org-selection pick from their memberships.
          const orgId = profiles.length === 1 ? profiles[0].organizationId : null;
          return this.resolveForUser(users[0], orgId, channel, channelUserId);
        }
        if (users.length > 1) {
          this.logger.warn(`WhatsApp number ${digits} is set on ${users.length} different users — ignoring.`);
        }
      }
    }
    return { ok: false, reason: 'unlinked' };
  }

  /** Build the org-scoped context for a resolved user. `preferredOrgId` is the
   *  stored/assigned org to prefer; when null (or not a membership) org-selection
   *  falls back to their memberships. `identityId` is set only for the
   *  OperatorIdentity path so we can persist the chosen org + touch lastSeenAt. */
  private async resolveForUser(
    clerkUserId: string,
    preferredOrgId: string | null,
    channel: OperatorChannel,
    channelUserId: string,
    opts: { displayName?: string | null; identityId?: string } = {},
  ): Promise<ResolveResult> {
    const [roles, memberships] = await Promise.all([
      this.prisma.userRole.findMany({
        where: { userId: clerkUserId, isActive: true },
        select: {
          organizationId: true,
          role: { select: { name: true, permissions: { select: { resource: true, action: true } } } },
        },
      }),
      this.prisma.userOrganization.findMany({
        where: { userId: clerkUserId, isActive: true },
        select: { organization: { select: { id: true, name: true } } },
      }),
    ]);

    const orgs = memberships.map((m) => m.organization).filter(Boolean) as Array<{ id: string; name: string }>;

    // osirisadmin is matched as a lowercase literal, same as ClerkAuthGuard.
    const isOsirisAdmin = roles.some((r) => r.role?.name === 'osirisadmin');

    // Never rely on findFirst — pick explicitly (assigned org, or the only one).
    let chosen = preferredOrgId ? orgs.find((o) => o.id === preferredOrgId) : undefined;

    // Global osirisadmin can operate in ANY org without a membership row, exactly
    // like ClerkAuthGuard's cross-org bypass. Honour the assigned org even when
    // it isn't among their memberships.
    if (!chosen && isOsirisAdmin && preferredOrgId) {
      const org = await this.prisma.organization.findUnique({
        where: { id: preferredOrgId },
        select: { id: true, name: true },
      });
      if (org) chosen = org;
    }

    if (!chosen) {
      if (!orgs.length) return { ok: false, reason: 'no-org' };
      if (orgs.length > 1) return { ok: false, reason: 'needs-org-choice', options: orgs };
      chosen = orgs[0];
      if (opts.identityId) {
        await this.prisma.operatorIdentity.update({
          where: { id: opts.identityId },
          data: { organizationId: chosen.id },
        });
      }
    }
    // Filter roles by the CHOSEN org (the guard filters by the membership org).
    const scopedRoles = roles
      .filter((r) => r.organizationId === chosen!.id && r.role)
      .map((r) => ({ name: r.role!.name, permissions: r.role!.permissions }));

    if (opts.identityId) {
      this.prisma.operatorIdentity
        .update({ where: { id: opts.identityId }, data: { lastSeenAt: new Date(), displayName: opts.displayName ?? undefined } })
        .catch(() => null); // best-effort touch
    }

    return {
      ok: true,
      ctx: {
        organizationId: chosen.id,
        organizationName: chosen.name,
        clerkUserId,
        actor: { id: clerkUserId, name: opts.displayName || undefined },
        roles: scopedRoles,
        isOsirisAdmin,
        channel,
        channelUserId,
      },
    };
  }

  async setOrganization(channel: OperatorChannel, channelUserId: string, organizationId: string) {
    const existing = await this.prisma.operatorIdentity.findUnique({
      where: { channel_channelUserId: { channel, channelUserId } },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.operatorIdentity.update({ where: { id: existing.id }, data: { organizationId } });
      return;
    }
    // Member-profile user with no identity row yet: create one to persist the
    // org they just chose (look up who this number belongs to in that org).
    if (channel === 'whatsapp') {
      const digits = String(channelUserId).replace(/\D/g, '');
      const prof = await this.prisma.organizationMemberProfile.findFirst({
        where: { whatsappNumber: digits, organizationId },
        select: { userId: true },
      });
      if (prof) {
        await this.prisma.operatorIdentity.upsert({
          where: { channel_channelUserId: { channel, channelUserId } },
          create: { channel, channelUserId, clerkUserId: prof.userId, organizationId, verified: true },
          update: { organizationId },
        });
      }
    }
  }

  /**
   * Permission check, replicating ClerkAuthGuard's semantics exactly:
   * a SINGLE role must satisfy ALL required permissions (they are not unioned
   * across roles); '*' is a wildcard on resource and/or action independently.
   */
  hasPermission(ctx: OperatorContext, required: string[]): boolean {
    if (!required.length) return true;
    if (ctx.isOsirisAdmin) return true;
    return ctx.roles.some((role) =>
      required.every((req) => {
        const [resource, action] = req.split(':');
        return role.permissions.some(
          (p) => (p.resource === resource || p.resource === '*') && (p.action === action || p.action === '*'),
        );
      }),
    );
  }
}
