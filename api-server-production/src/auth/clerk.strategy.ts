import { verifyToken } from '@clerk/backend';
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
  id: string;
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

  async validate(req: Request): Promise<AuthenticatedUser> {
    const token = req.headers.authorization?.split(' ').pop();

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      // verifyToken authenticates the session locally (signature + expiry) with
      // no network call. This runs on EVERY request and is the real auth check.
      const payload = await verifyToken(token, {
        secretKey: this.configService.get('CLERK_SECRET_KEY'),
      });
      const claims = payload as Record<string, any>;

      // Prefer identity claims embedded in the session token
      // (Clerk Dashboard → Sessions → Customize session token). When present we
      // skip the per-request round-trip to Clerk's API entirely.
      const firstName = (claims.first_name ?? claims.firstName ?? null) as string | null;
      const lastName = (claims.last_name ?? claims.lastName ?? null) as string | null;
      const email = (claims.email ?? claims.primary_email ?? claims.primaryEmail) as string | undefined;

      const hasIdentityClaims = firstName !== null || lastName !== null || email !== undefined;
      if (hasIdentityClaims) {
        return {
          id: payload.sub,
          firstName,
          lastName,
          emailAddresses: email ? [{ emailAddress: email }] : [],
        };
      }

      // Fallback: identity claims not configured on the session token yet —
      // fetch the full profile once (original behavior). Configuring the claims
      // in the Clerk dashboard eliminates this network call.
      return await this.clerkClient.users.getUser(payload.sub);
    } catch (error) {
      console.error(error);
      throw new UnauthorizedException('Invalid token');
    }
  }
}
