import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { SITECLOCK_DELIVERIES_FLAG, isOrgFeatureEnabled } from '../common/org-features';
import { isManualOrderFlow } from '../orders/manual-order-flow';
import { resolveSiteClockWorker, WORKER_REFUSAL } from '../siteclock/siteclock-worker';

export const WORKER_HEADER = 'x-siteclock-worker-id';

/**
 * SiteClock worker delivery API (2026-11-06), after SiteClockInboundGuard (the
 * org's inbound key = the org, and the SiteClock link is on). SiteClock's
 * backend calls on behalf of ONE signed-in worker, named by
 * `X-SiteClock-Worker-Id: <SiteClock user id>`; it never reaches AIMS from a
 * phone directly. Refuses unless:
 *
 *   - enableSiteClockDeliveries is on for the org                → 403 DELIVERIES_OFF
 *   - the worker is an active AIMS member with a field role      → 403 NOT_LINKED / NOT_A_MEMBER / NO_FIELD_ROLE
 *   - (routes under /jobs/:ref) the job AIMS synced to SiteClock under that
 *     ref is on THIS worker and not cancelled                     → 404 NOT_YOUR_JOB
 *
 * Sets req.siteclockWorker (the AIMS user the services act as; the Activity
 * Log names them) and req.siteclockJob (the run behind the ref).
 */
@Injectable()
export class SiteClockWorkerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const organizationId: string | undefined = req.userOrganization?.id;
    if (!organizationId) throw new UnauthorizedException('Missing SiteClock key');
    // Manual order flow: the office completes jobs in AIMS, so SiteClock deliveries are off for it.
    if (!(await isOrgFeatureEnabled(this.prisma, organizationId, SITECLOCK_DELIVERIES_FLAG)) || (await isManualOrderFlow(this.prisma, organizationId))) {
      throw new ForbiddenException({ message: 'Deliveries in SiteClock are turned off for this organisation.', data: { code: 'DELIVERIES_OFF' } });
    }
    const raw = req.headers?.[WORKER_HEADER];
    const siteclockUserId = (Array.isArray(raw) ? raw[0] : raw ?? '').toString().trim();
    if (!siteclockUserId || siteclockUserId.length > 100) throw new UnauthorizedException({ message: 'Missing X-SiteClock-Worker-Id', data: { code: 'NO_WORKER' } });
    const who = await resolveSiteClockWorker(this.prisma, organizationId, siteclockUserId);
    if ('reason' in who) throw new ForbiddenException({ message: WORKER_REFUSAL[who.reason], data: { code: who.reason } });

    const ref = req.params?.ref;
    let workerName: string | null = null;
    if (ref !== undefined) {
      const link = await this.prisma.deliverySiteClockJob.findFirst({
        where: { organizationId, externalRef: String(ref) },
        select: { id: true, deliveryId: true, workerId: true, workerName: true, lastPushedStatus: true },
      });
      if (!link || link.workerId !== siteclockUserId || link.lastPushedStatus === 'CANCELLED') {
        throw new NotFoundException({ message: 'This job is not on your schedule.', data: { code: 'NOT_YOUR_JOB' } });
      }
      workerName = link.workerName ?? null;
      req.siteclockJob = { deliveryId: link.deliveryId, linkId: link.id, externalRef: String(ref) };
    }
    if (!workerName) {
      // Pending sign / uploads: the name SiteClock last gave this worker on any job.
      const any = await this.prisma.deliverySiteClockJob.findFirst({
        where: { organizationId, workerId: siteclockUserId, workerName: { not: null } },
        orderBy: { updatedAt: 'desc' },
        select: { workerName: true },
      });
      workerName = any?.workerName ?? null;
    }
    req.siteclockWorker = { userId: who.userId, siteclockUserId, name: workerName };
    return true;
  }
}
