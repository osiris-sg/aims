import { createClerkClient, verifyToken } from '@clerk/backend';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { Request } from 'express';
import { ClerkClient } from '@clerk/backend';

/**
 * Minimal identity shape attached to `request.user`. A real Clerk `User` is a
 * structural superset of this, so the legacy fallback path below is assignable.
 * Downstream only reads `id`, `firstName`, `lastName`, and
 * `emailAddresses[0].emailAddress` (audit interceptor + assets attribution).
 */
export interface AuthenticatedUser {
  /**
   * The AIMS user id: what every DB column stores. On the Clerk production
   * instance an imported user carries their pre-move (dev instance) id in the
   * `aims_uid` session claim (from {{user.external_id}}); otherwise the token's
   * `sub`. See docs/clerk-cutover.md.
   */
  id: string;
  /** The Clerk user id of the session (`sub`). Use for Clerk API calls. */
  clerkId?: string;
  firstName: string | null;
  lastName: string | null;
  emailAddresses: { emailAddress: string }[];
}

@Injectable()
export class ClerkStrategy extends PassportStrategy(Strategy, 'clerk') {
  constructor(
    @Inject('ClerkClient')
    private readonly clerkClient: ClerkClient,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  // Lazily built client for the LEGACY instance, only used when a token was
  // verified with CLERK_SECRET_KEY_LEGACY (cutover window) and carries no
  // identity claims, so its profile must come from the instance that issued it.
  private legacyClient: ClerkClient | null = null;

  /**
   * Verify against CLERK_SECRET_KEY, then CLERK_SECRET_KEY_LEGACY when set (the
   * old instance during the cutover window). CLERK_AUTHORIZED_PARTIES is a
   * comma list of allowed origins (azp); unset = no azp check, as before.
   */
  private async verify(token: string): Promise<{ payload: Record<string, any>; legacy: boolean }> {
    const parties = String(this.configService.get('CLERK_AUTHORIZED_PARTIES') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const extra = parties.length ? { authorizedParties: parties } : {};
    const primary = this.configService.get<string>('CLERK_SECRET_KEY');
    const legacyKey = this.configService.get<string>('CLERK_SECRET_KEY_LEGACY');
    try {
      return { payload: (await verifyToken(token, { secretKey: primary, ...extra })) as Record<string, any>, legacy: false };
    } catch (err) {
      if (!legacyKey) throw err;
      return { payload: (await verifyToken(token, { secretKey: legacyKey, ...extra })) as Record<string, any>, legacy: true };
    }
  }

  async validate(req: Request): Promise<AuthenticatedUser> {
    const token = req.headers.authorization?.split(' ').pop();

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      // verifyToken authenticates the session locally (signature + expiry) with
      // no network call. This runs on EVERY request and is the real auth check.
      const { payload, legacy } = await this.verify(token);
      const claims = payload;
      const clerkId = payload.sub as string;
      // The AIMS (DB) id: the imported user's pre-move id when the production
      // session token carries it, else the session's own Clerk id. On the dev
      // instance there is no aims_uid claim, so this is exactly `sub`.
      const aimsUid = typeof claims.aims_uid === 'string' ? claims.aims_uid.trim() : '';
      const id = aimsUid || clerkId;

      // Prefer identity claims embedded in the session token
      // (Clerk Dashboard → Sessions → Customize session token). When present we
      // skip the per-request round-trip to Clerk's API entirely.
      const firstName = (claims.first_name ?? claims.firstName ?? null) as string | null;
      const lastName = (claims.last_name ?? claims.lastName ?? null) as string | null;
      const email = (claims.email ?? claims.primary_email ?? claims.primaryEmail) as string | undefined;

      const hasIdentityClaims = firstName !== null || lastName !== null || email !== undefined;
      if (hasIdentityClaims) {
        return {
          id,
          clerkId,
          firstName,
          lastName,
          emailAddresses: email ? [{ emailAddress: email }] : [],
        };
      }

      // Fallback: identity claims not configured on the session token yet —
      // fetch the full profile once (original behavior), from the instance
      // that issued the token. Configuring the claims in the Clerk dashboard
      // eliminates this network call.
      const client = legacy ? this.legacy() : this.clerkClient;
      const user = await client.users.getUser(clerkId);
      if (id === user.id) return user; // dev instance: unchanged object
      return {
        id,
        clerkId,
        firstName: user.firstName,
        lastName: user.lastName,
        emailAddresses: user.emailAddresses.map((e) => ({ emailAddress: e.emailAddress })),
      };
    } catch (error) {
      console.error(error);
      throw new UnauthorizedException('Invalid token');
    }
  }

  private legacy(): ClerkClient {
    if (!this.legacyClient) {
      this.legacyClient = createClerkClient({ secretKey: this.configService.get('CLERK_SECRET_KEY_LEGACY') });
    }
    return this.legacyClient;
  }
}
