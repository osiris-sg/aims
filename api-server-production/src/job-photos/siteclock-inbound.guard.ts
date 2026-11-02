import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { SiteClockLinkService } from '../siteclock/siteclock-link.service';
import { bearerOf, hashInboundKey, INBOUND_KEY_PREFIX } from './job-photos';

/**
 * SiteClock → AIMS calls (job photos). SiteClock sends the org's inbound key
 * (generated in Admin → organisation → SiteClock tab) as
 * `Authorization: Bearer aims_sck_…`; only its sha256 is stored, on the org's
 * SiteClockConnection, so the key IS the org context.
 *
 *   no / unknown key           → 401
 *   valid key, link turned off → 403 (flag enableSiteClockLink off or the connection disabled)
 *
 * Sets req.userOrganization like the other guards (the tenancy interceptor and
 * the Activity Log read it) and req.siteclockInbound for the log's actor. The
 * key itself is never logged or echoed.
 */
@Injectable()
export class SiteClockInboundGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly link: SiteClockLinkService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const key = bearerOf(req.headers?.['authorization']);
    if (!key || !key.startsWith(INBOUND_KEY_PREFIX)) throw new UnauthorizedException('Missing SiteClock key (Authorization: Bearer aims_sck_...)');
    const conn = await this.prisma.siteClockConnection.findFirst({
      where: { inboundKeyHash: hashInboundKey(key) },
      select: { id: true, organizationId: true, inboundKeyLastUsedAt: true },
    });
    if (!conn) throw new UnauthorizedException('Invalid SiteClock key');
    if (!(await this.link.isLinked(conn.organizationId))) throw new ForbiddenException('The SiteClock link is turned off for this organisation');
    const org = await this.prisma.organization.findUnique({ where: { id: conn.organizationId }, select: { id: true, name: true } });
    if (!org) throw new UnauthorizedException('Invalid SiteClock key');
    req.userOrganization = { id: org.id, name: org.name };
    req.siteclockInbound = { connectionId: conn.id };
    // Touch lastUsedAt at most once a minute; never block the request on it.
    if (!conn.inboundKeyLastUsedAt || Date.now() - conn.inboundKeyLastUsedAt.getTime() > 60_000) {
      this.prisma.siteClockConnection.update({ where: { id: conn.id }, data: { inboundKeyLastUsedAt: new Date() } }).catch(() => {});
    }
    return true;
  }
}
