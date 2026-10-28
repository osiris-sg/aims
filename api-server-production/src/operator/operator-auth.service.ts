import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { OperatorChannel, OperatorContext } from './operator.types';
import { ClerkIdentityService } from '../clerk/clerk-identity.service';

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

  constructor(
    private readonly prisma: PrismaService,
    // Optional: only the impersonation lookup needs it, and the rest of this
    // service must keep working if Clerk is unreachable or unconfigured.
    @Optional() private readonly clerkIdentity?: ClerkIdentityService,
  ) {}

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
      const variants = this.numberVariants(channelUserId);
      if (!variants.length) return false;
      const prof = await this.prisma.organizationMemberProfile.findFirst({
        where: { whatsappNumber: { in: variants } },
        select: { id: true },
      });
      return !!prof;
    }
    return false;
  }

  /** The spellings a Singapore number may be stored under: with and without
   *  the 65 prefix (profiles saved from the admin page sometimes lack it —
   *  guru 2026-10-13, Ryann's 91331398 vs WhatsApp's 6591331398). */
  private numberVariants(raw: string): string[] {
    const digits = String(raw).replace(/\D/g, '');
    if (!digits) return [];
    const v = new Set<string>([digits]);
    if (digits.startsWith('65') && digits.length === 10) v.add(digits.slice(2));
    if (digits.length === 8) v.add('65' + digits);
    return [...v];
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
      const variants = this.numberVariants(channelUserId);
      if (variants.length) {
        const profiles = await this.prisma.organizationMemberProfile.findMany({
          where: { whatsappNumber: { in: variants } },
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
          this.logger.warn(`WhatsApp number ${variants[0]} is set on ${users.length} different users — ignoring.`);
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
      // osirisadmin works in ANY org, membership or not — so the FIRST-TIME
      // picker has to offer all of them, exactly as /org does. Listing only
      // memberships here showed the platform admin two orgs out of seven
      // (guru 2026-09-25); /org was fixed earlier and this path was missed.
      const pickable = isOsirisAdmin ? await this.listOrgOptions({ clerkUserId, isOsirisAdmin }) : orgs;
      if (!pickable.length) return { ok: false, reason: 'no-org' };
      if (pickable.length > 1) return { ok: false, reason: 'needs-org-choice', options: pickable };
      chosen = pickable[0];
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

  /**
   * Orgs this user may operate in, for the /org picker.
   *
   * osirisadmin bypasses membership rows entirely (same cross-org rule as
   * ClerkAuthGuard), so listing only UserOrganization would show them a short
   * or empty list while they can in fact work anywhere. `query` filters by
   * name so a long list stays reachable when the channel caps the picker.
   */
  async listOrgOptions(
    ctx: { clerkUserId: string; isOsirisAdmin: boolean },
    query?: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const where = query?.trim() ? { name: { contains: query.trim(), mode: 'insensitive' as const } } : {};
    if (ctx.isOsirisAdmin) {
      return this.prisma.organization.findMany({
        where,
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: 50,
      });
    }
    const memberships = await this.prisma.userOrganization.findMany({
      where: { userId: ctx.clerkUserId, isActive: true, organization: where },
      select: { organization: { select: { id: true, name: true } } },
      take: 50,
    });
    return memberships
      .map((m) => m.organization)
      .filter(Boolean)
      .sort((a, b) => a!.name.localeCompare(b!.name)) as Array<{ id: string; name: string }>;
  }

  /** May this user operate in that org? Mirrors listOrgOptions' rules. */
  async canUseOrg(ctx: { clerkUserId: string; isOsirisAdmin: boolean }, organizationId: string) {
    if (ctx.isOsirisAdmin) {
      return this.prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } });
    }
    const membership = await this.prisma.userOrganization.findFirst({
      where: { userId: ctx.clerkUserId, organizationId, isActive: true },
      select: { organization: { select: { id: true, name: true } } },
    });
    return membership?.organization ?? null;
  }

  /**
   * Accept an org pick from a sender who has NO org stored yet.
   *
   * resolve() returns needs-org-choice before handleInbound reaches its button
   * handler, so the tap that answers the picker was itself being swallowed and
   * re-prompted forever (guru 2026-09-25). This resolves the identity directly,
   * applies the same access rule, and stores the choice.
   */
  async chooseOrgWhileUnset(
    channel: OperatorChannel,
    channelUserId: string,
    organizationId: string,
  ): Promise<{ id: string; name: string } | null> {
    const identity = await this.prisma.operatorIdentity.findUnique({
      where: { channel_channelUserId: { channel, channelUserId } },
      select: { clerkUserId: true },
    });
    let clerkUserId = identity?.clerkUserId;
    if (!clerkUserId && channel === 'whatsapp') {
      const prof = await this.prisma.organizationMemberProfile.findFirst({
        where: { whatsappNumber: { in: this.numberVariants(channelUserId) } },
        select: { userId: true },
      });
      clerkUserId = prof?.userId;
    }
    if (!clerkUserId) return null;
    const roles = await this.prisma.userRole.findMany({
      where: { userId: clerkUserId, isActive: true },
      select: { role: { select: { name: true } } },
    });
    const isOsirisAdmin = roles.some((r) => r.role?.name === 'osirisadmin');
    const org = await this.canUseOrg({ clerkUserId, isOsirisAdmin }, organizationId);
    if (!org) return null;
    await this.setOrganization(channel, channelUserId, organizationId);
    return org;
  }

  /**
   * Everyone with a role in this org, with names/emails from Clerk.
   *
   * AIMS stores neither — identity is Clerk-only, and UserRole holds raw Clerk
   * ids — so a human-readable list has to be assembled here. `query` matches
   * name or email so an admin can say "act as eve" rather than paste an id.
   */
  async listOrgUsers(organizationId: string, query?: string) {
    const [roles, members] = await Promise.all([
      this.prisma.userRole.findMany({
        where: { organizationId, isActive: true },
        select: { userId: true, role: { select: { name: true } } },
      }),
      this.prisma.userOrganization.findMany({
        where: { organizationId, isActive: true },
        select: { userId: true },
      }),
    ]);
    const ids = [...new Set([...roles.map((r) => r.userId), ...members.map((m) => m.userId)])];
    const out: Array<{ userId: string; name: string; email: string; roles: string }> = [];
    // DB ids -> Clerk users in one batched lookup (by external_id, then id).
    const clerkUsers = this.clerkIdentity
      ? await this.clerkIdentity.toClerkUsers(ids.slice(0, 40)).catch(() => new Map())
      : new Map();
    for (const id of ids.slice(0, 40)) {
      let name = '';
      let email = '';
      try {
        const u: any = clerkUsers.get(id);
        name = [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.username || '';
        email =
          (u?.emailAddresses || []).find((e: any) => e.id === u?.primaryEmailAddressId)?.emailAddress ||
          u?.emailAddresses?.[0]?.emailAddress ||
          '';
      } catch {
        /* a deleted or unreachable Clerk user still deserves a row */
      }
      out.push({
        userId: id,
        name: name || '(no name)',
        email: email || '',
        roles: roles.filter((r) => r.userId === id).map((r) => r.role?.name).filter(Boolean).join(', ') || '(no role)',
      });
    }
    const q = (query || '').trim().toLowerCase();
    if (!q) return out;
    return out.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.userId === query,
    );
  }

  /**
   * Rebuild the context as another user in the same org.
   *
   * isOsirisAdmin is deliberately NOT carried over: the point of acting as
   * someone is to hit the walls they hit. Keeping the bypass would show the
   * admin a world nobody else can see, which is the opposite of troubleshooting.
   */
  async contextAs(ctx: OperatorContext, targetUserId: string, label: string): Promise<OperatorContext> {
    const roles = await this.prisma.userRole.findMany({
      where: { userId: targetUserId, organizationId: ctx.organizationId, isActive: true },
      select: { role: { select: { name: true, permissions: { select: { resource: true, action: true } } } } },
    });
    return {
      ...ctx,
      clerkUserId: targetUserId,
      actor: { id: targetUserId, name: label },
      roles: roles.filter((r) => r.role).map((r) => ({ name: r.role!.name, permissions: r.role!.permissions })),
      isOsirisAdmin: roles.some((r) => r.role?.name === 'osirisadmin'),
      impersonating: { byUserId: ctx.clerkUserId, label },
    };
  }

  /**
   * Context for the dashboard chat: the Clerk session already proved who the
   * user is, and the guard already chose the active org (membership org, or
   * the admin's X-Active-Org-Id switch). Only the org-scoped roles are read.
   */
  async contextForWeb(
    clerkUserId: string,
    org: { id: string; name: string },
    actor: { name?: string; email?: string },
    isOsirisAdmin: boolean,
  ): Promise<OperatorContext> {
    const roles = await this.prisma.userRole.findMany({
      where: { userId: clerkUserId, organizationId: org.id, isActive: true },
      select: { role: { select: { name: true, permissions: { select: { resource: true, action: true } } } } },
    });
    return {
      organizationId: org.id,
      organizationName: org.name,
      clerkUserId,
      actor: { id: clerkUserId, name: actor.name, email: actor.email },
      roles: roles.filter((r) => r.role).map((r) => ({ name: r.role!.name, permissions: r.role!.permissions })),
      isOsirisAdmin,
      channel: 'web',
      channelUserId: clerkUserId,
    };
  }

  /** The WhatsApp numbers this user's operator chats run under, in this org.
   *  Used by the web chat to show and continue their WhatsApp thread. */
  async whatsappChatIdsForUser(clerkUserId: string, organizationId: string): Promise<string[]> {
    const [ids, profiles] = await Promise.all([
      this.prisma.operatorIdentity.findMany({
        where: { channel: 'whatsapp', clerkUserId, verified: true },
        select: { channelUserId: true },
      }),
      this.prisma.organizationMemberProfile.findMany({
        where: { userId: clerkUserId, organizationId, whatsappNumber: { not: null } },
        select: { whatsappNumber: true },
      }),
    ]);
    const out = new Set<string>();
    ids.forEach((i) => out.add(i.channelUserId));
    profiles.forEach((p) => this.numberVariants(p.whatsappNumber || '').forEach((v) => out.add(v)));
    return [...out];
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
    // org they just chose. The number is looked up on ANY of the person's
    // member profiles, not only the target org's: a user known through their
    // Biofuel profile switching to WCT (where they have no profile) used to
    // get "Now working in WCT" and then silently land back in Biofuel on the
    // next message, because nothing was stored (guru 2026-10-28).
    if (channel === 'whatsapp') {
      const profiles = await this.prisma.organizationMemberProfile.findMany({
        where: { whatsappNumber: { in: this.numberVariants(channelUserId) } },
        select: { userId: true, organizationId: true },
      });
      const users = [...new Set(profiles.map((p) => p.userId))];
      const userId = users.length === 1 ? users[0] : profiles.find((p) => p.organizationId === organizationId)?.userId;
      if (userId) {
        await this.prisma.operatorIdentity.upsert({
          where: { channel_channelUserId: { channel, channelUserId } },
          create: { channel, channelUserId, clerkUserId: userId, organizationId, verified: true },
          update: { organizationId },
        });
      } else {
        this.logger.warn(`setOrganization: no identity and no member profile for ${channelUserId}; the org choice could not be stored`);
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
