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
  async resolve(channel: OperatorChannel, channelUserId: string): Promise<ResolveResult> {
    const identity = await this.prisma.operatorIdentity.findUnique({
      where: { channel_channelUserId: { channel, channelUserId } },
    });
    if (!identity || !identity.verified) return { ok: false, reason: 'unlinked' };

    const [roles, memberships] = await Promise.all([
      this.prisma.userRole.findMany({
        where: { userId: identity.clerkUserId, isActive: true },
        select: {
          organizationId: true,
          role: { select: { name: true, permissions: { select: { resource: true, action: true } } } },
        },
      }),
      this.prisma.userOrganization.findMany({
        where: { userId: identity.clerkUserId, isActive: true },
        select: { organization: { select: { id: true, name: true } } },
      }),
    ]);

    const orgs = memberships.map((m) => m.organization).filter(Boolean) as Array<{ id: string; name: string }>;
    if (!orgs.length) return { ok: false, reason: 'no-org' };

    // Never rely on findFirst — pick explicitly (stored choice, or the only one).
    let chosen = identity.organizationId ? orgs.find((o) => o.id === identity.organizationId) : undefined;
    if (!chosen) {
      if (orgs.length > 1) return { ok: false, reason: 'needs-org-choice', options: orgs };
      chosen = orgs[0];
      await this.prisma.operatorIdentity.update({
        where: { id: identity.id },
        data: { organizationId: chosen.id },
      });
    }

    // osirisadmin is matched as a lowercase literal, same as ClerkAuthGuard.
    const isOsirisAdmin = roles.some((r) => r.role?.name === 'osirisadmin');
    // Filter roles by the CHOSEN org (the guard filters by the membership org).
    const scopedRoles = roles
      .filter((r) => r.organizationId === chosen!.id && r.role)
      .map((r) => ({ name: r.role!.name, permissions: r.role!.permissions }));

    this.prisma.operatorIdentity
      .update({ where: { id: identity.id }, data: { lastSeenAt: new Date(), displayName: identity.displayName } })
      .catch(() => null); // best-effort touch

    return {
      ok: true,
      ctx: {
        organizationId: chosen.id,
        organizationName: chosen.name,
        clerkUserId: identity.clerkUserId,
        actor: { id: identity.clerkUserId, name: identity.displayName || undefined },
        roles: scopedRoles,
        isOsirisAdmin,
        channel,
        channelUserId,
      },
    };
  }

  async setOrganization(channel: OperatorChannel, channelUserId: string, organizationId: string) {
    await this.prisma.operatorIdentity.update({
      where: { channel_channelUserId: { channel, channelUserId } },
      data: { organizationId },
    });
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
