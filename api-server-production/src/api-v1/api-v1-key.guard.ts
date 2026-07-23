import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { PrismaService } from '../common/prisma.service';

// ---------------------------------------------------------------------------
// DB-backed per-org API-key auth for the external /v1 API.
//
// DISTINCT from src/public-api/api-key.guard.ts (water-sg's single env-var
// shared secret): here keys live in the ApiKey table — one or more per org,
// revocable, scoped, with an autoPost flag. The key IS the org context.
//
// v1 controllers are @Public() (skips the global ClerkAuthGuard) and guarded
// here instead. A valid key injects req.userOrganization = { id, name } — the
// same shape Clerk-guarded controllers use — so downstream services work
// unchanged.
// ---------------------------------------------------------------------------

export const API_V1_SCOPE_KEY = 'apiV1Scope';
export const RequireScope = (scope: string) => SetMetadata(API_V1_SCOPE_KEY, scope);

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

@Injectable()
export class ApiV1KeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const auth: string = (req.headers['authorization'] as string) || '';
    const plaintext =
      (auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '') ||
      ((req.headers['x-api-key'] as string) || '').trim();

    if (!plaintext || !plaintext.startsWith('aims_')) {
      throw new UnauthorizedException('Missing API key (Authorization: Bearer aims_...)');
    }

    const key = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(plaintext) },
      include: { organization: { select: { id: true, name: true } } },
    });
    if (!key) throw new UnauthorizedException('Invalid API key');
    if (key.revokedAt) throw new UnauthorizedException('API key has been revoked');

    const requiredScope = this.reflector.getAllAndOverride<string>(API_V1_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredScope && !key.scopes.includes(requiredScope)) {
      throw new ForbiddenException(`API key lacks the "${requiredScope}" scope`);
    }

    // Same request shape the Clerk guard produces.
    req.userOrganization = { id: key.organization.id, name: key.organization.name };
    req.apiKey = { id: key.id, name: key.name, scopes: key.scopes, autoPost: key.autoPost };

    // Touch lastUsedAt at most once a minute; never block the request on it.
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
      this.prisma.apiKey
        .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});
    }
    return true;
  }
}
