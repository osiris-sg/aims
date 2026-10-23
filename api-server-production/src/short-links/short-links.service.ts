/**
 * Short links (round AD, 2026-10-23, owner: "https://app.ai-ms.io/go/<short-token> … expires after 30 days;
 * requires login as now; reveals nothing without a session").
 *
 * A token maps to (organization, portal path). The WhatsApp pushes carry `…/go/abc123` instead of
 * `…/portal?view=emails&aorg=<36-char org id>`. The portal page /go/<token> (behind Clerk) asks GET /go/:token;
 * the resolver answers only a signed-in member of that org (or an osiris admin, whose link opens under that org
 * via ?aorg=). Unknown / expired / someone else's token = 404 with no detail.
 *
 * Only the shipments pushes create links today; the resolver is generic.
 */
import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma.service';

const DAYS = 30;
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no 0/o/1/l — the token is read aloud sometimes
export const SHORT_TOKEN_RE = /^[a-z0-9]{6,12}$/;

export function randomToken(len = 8): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export const withOrg = (path: string, organizationId: string) => `${path}${path.includes('?') ? '&' : '?'}aorg=${organizationId}`;

@Injectable()
export class ShortLinksService {
  private readonly logger = new Logger(ShortLinksService.name);

  constructor(private readonly prisma: PrismaService) {}

  base(): string {
    return process.env.PORTAL_URL || 'https://app.ai-ms.io';
  }

  /** The short URL for a portal path of an org. Never throws: when the table is unreachable the long link is used. */
  async url(organizationId: string, path: string): Promise<string> {
    try {
      return `${this.base()}/go/${await this.token(organizationId, path)}`;
    } catch (e: any) {
      this.logger.warn(`short link failed (${e?.message}) — long link used`);
      return `${this.base()}${withOrg(path, organizationId)}`;
    }
  }

  /** Today's token for (org, path) when one exists (one link per day per destination), else a new one. */
  async token(organizationId: string, path: string): Promise<string> {
    const now = new Date();
    const existing: { token: string } | null = await this.prisma.shortLink.findFirst({
      where: { organizationId, path, createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) }, expiresAt: { gt: new Date(now.getTime() + 7 * 86_400_000) } },
      select: { token: true },
    });
    if (existing) return existing.token;
    for (let attempt = 0; attempt < 5; attempt++) {
      const token = randomToken(8);
      try {
        await this.prisma.shortLink.create({ data: { token, organizationId, path, expiresAt: new Date(now.getTime() + DAYS * 86_400_000) } });
        return token;
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e; // P2002 = token taken — try another
      }
    }
    throw new Error('could not allocate a short link token');
  }

  /**
   * Resolve for a signed-in caller: the path to go to, or null (unknown, expired, or not this caller's org).
   * An osiris admin's link carries ?aorg=<org> so the new tab opens under that org (helpers/request.ts adopts it).
   */
  async resolve(token: string, caller: { organizationId: string | null; isOsirisAdmin: boolean }): Promise<{ path: string; organizationId: string } | null> {
    if (!SHORT_TOKEN_RE.test(token)) return null;
    const row: { organizationId: string; path: string; expiresAt: Date } | null = await this.prisma.shortLink.findUnique({ where: { token }, select: { organizationId: true, path: true, expiresAt: true } });
    if (!row || row.expiresAt.getTime() < Date.now()) return null;
    if (!caller.isOsirisAdmin && caller.organizationId !== row.organizationId) return null;
    this.prisma.shortLink.update({ where: { token }, data: { hits: { increment: 1 }, lastUsedAt: new Date() } }).catch(() => undefined);
    return { path: caller.isOsirisAdmin ? withOrg(row.path, row.organizationId) : row.path, organizationId: row.organizationId };
  }
}
