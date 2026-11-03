import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { isOrgFeatureEnabled } from '../common/org-features';
import { calendarBadge, isJobFieldsEnabled, jobFieldDefs, jobFieldValues } from './job-fields';
import { checkOrderJobFilters, OrderJobFilters, orderJobState, orderJobsWhere, orderJobWorker } from './order-jobs';

/** WCT Orders → Jobs. See order-jobs.ts. */
@Injectable()
export class OrderJobsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, f: OrderJobFilters & { page?: number; limit?: number }) {
    if (!(await isOrgFeatureEnabled(this.prisma, organizationId, 'enableWctOrders'))) throw new NotFoundException('Order jobs are not enabled for this organisation');
    const bad = checkOrderJobFilters(f);
    if (bad) throw new BadRequestException(bad);
    const page = Math.max(1, f.page ?? 1);
    const limit = Math.min(100, Math.max(1, f.limit ?? 25));

    const worker = (f.worker || '').trim();
    const workerJobIds = worker ? (await this.prisma.deliverySiteClockJob.findMany({ where: { organizationId, workerName: worker }, select: { deliveryId: true } })).map((r) => r.deliveryId) : [];
    const where = orderJobsWhere(organizationId, f, workerJobIds);
    const [rows, total] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        orderBy: [{ scheduledFor: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          deliveryNumber: true,
          direction: true,
          status: true,
          isDraft: true,
          verificationState: true,
          scheduledFor: true,
          siteAddress: true,
          plannedRiderName: true,
          riderName: true,
          order: { select: { id: true, orderNumber: true } },
          customer: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          items: { select: { document: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.delivery.count({ where }),
    ]);
    const ids = rows.map((r) => r.id);
    const [links, badgesByJob] = await Promise.all([
      ids.length
        ? this.prisma.deliverySiteClockJob.findMany({ where: { organizationId, deliveryId: { in: ids } }, select: { deliveryId: true, workerName: true } })
        : Promise.resolve([] as Array<{ deliveryId: string; workerName: string | null }>),
      this.badges(organizationId, ids),
    ]);
    const scWorker = new Map<string, string | null>(links.map((l) => [l.deliveryId, l.workerName] as [string, string | null]));
    const docs = rows.map((r) => {
      const dos = new Map<string, { id: string; name: string | null }>();
      for (const it of r.items) if (it.document) dos.set(it.document.id, it.document);
      return {
        id: r.id,
        deliveryNumber: r.deliveryNumber,
        direction: r.direction,
        status: r.status,
        isDraft: r.isDraft,
        verificationState: r.verificationState,
        state: orderJobState(r),
        scheduledFor: r.scheduledFor,
        order: r.order,
        customer: r.customer,
        site: r.siteAddress || r.project?.name || null,
        worker: orderJobWorker(r, scWorker.get(r.id)),
        dos: [...dos.values()],
        badges: badgesByJob.get(r.id) ?? [],
      };
    });
    return { docs, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)), workers: await this.workers(organizationId) };
  }

  /** The worker filter's choices: every name on this org's order jobs. */
  private async workers(organizationId: string): Promise<string[]> {
    const [runs, sc] = await Promise.all([
      this.prisma.delivery.findMany({ where: { organizationId, orderId: { not: null } }, select: { plannedRiderName: true, riderName: true }, distinct: ['plannedRiderName', 'riderName'] }),
      this.prisma.deliverySiteClockJob.findMany({ where: { organizationId, workerName: { not: null } }, select: { workerName: true }, distinct: ['workerName'] }),
    ]);
    const names = new Set<string>();
    for (const r of runs) for (const n of [r.plannedRiderName, r.riderName]) if (n) names.add(n);
    for (const s of sc) if (s.workerName) names.add(s.workerName);
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  /** Custom job fields (e.g. "Permit required"): the same badges the calendar draws. */
  private async badges(organizationId: string, ids: string[]) {
    const out = new Map<string, any[]>();
    if (!ids.length || !(await isJobFieldsEnabled(this.prisma, organizationId))) return out;
    const defs = await jobFieldDefs(this.prisma, organizationId);
    const values = await jobFieldValues(this.prisma, organizationId, ids, defs);
    for (const id of ids) {
      const v = values.get(id) ?? {};
      out.set(id, defs.map((d) => calendarBadge(d, v[d.id])).filter(Boolean));
    }
    return out;
  }
}
