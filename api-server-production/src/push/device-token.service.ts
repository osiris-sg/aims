import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

/**
 * Device-token registry for push. One row per (user, token, org) — see the
 * DeviceToken model comment for why the org is part of the key.
 */
@Injectable()
export class DeviceTokenService {
  private readonly logger = new Logger(DeviceTokenService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Register or refresh. The app calls this on every start, so the common case
   * is an existing row whose lastSeenAt moves — that timestamp is what lets a
   * later cleanup tell a live device from one that was wiped months ago.
   *
   * The unique key is (userId, token), so the SAME token registering under a
   * SECOND org creates a second row rather than stealing the first. That is
   * intended: a user with roles in two orgs must receive both orgs' sends.
   */
  async register(
    userId: string,
    organizationId: string,
    dto: { token: string; platform?: string },
  ): Promise<{ registered: true }> {
    const token = dto.token.trim();
    const platform = dto.platform ?? 'android';
    const now = new Date();

    // upsert() keys on (userId, token) only, so a token that moved to a new org
    // would UPDATE the old row's organizationId rather than add one. Do it in
    // two steps instead: exact (userId, organizationId, token) match wins.
    const existing = await this.prisma.deviceToken.findFirst({
      where: { userId, organizationId, token },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.deviceToken.update({
        where: { id: existing.id },
        data: { lastSeenAt: now, platform },
      });
      return { registered: true };
    }

    try {
      await this.prisma.deviceToken.create({
        data: { userId, organizationId, token, platform, lastSeenAt: now },
      });
    } catch (e: any) {
      // P2002 on (userId, token): the same user already has this token under a
      // DIFFERENT org. Re-point that row — a physical device belongs to whoever
      // is signed in on it right now, and the app registers per active org.
      if (e?.code === 'P2002') {
        await this.prisma.deviceToken.updateMany({
          where: { userId, token },
          data: { organizationId, platform, lastSeenAt: now },
        });
        return { registered: true };
      }
      throw e;
    }
    this.logger.log(`device token registered for user ${userId} in org ${organizationId}`);
    return { registered: true };
  }

  /**
   * Drop a token on logout. Scoped to the caller's own userId so one user can
   * never unregister another's device. Idempotent — deleting an unknown token
   * is a success, because the caller's intent (not being messaged) is met.
   */
  async remove(userId: string, token: string): Promise<{ removed: number }> {
    const res = await this.prisma.deviceToken.deleteMany({ where: { userId, token: token.trim() } });
    return { removed: res.count };
  }
}
