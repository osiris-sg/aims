import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { isOrgFeatureEnabled } from '../common/org-features';
import { SiteClockLinkService } from '../siteclock/siteclock-link.service';
import { buildCalendarEvents, CalendarEvent, CalendarSiteClockJob, CALENDAR_TZ, checkRange, rangeInstants } from './jobs-calendar';
import { calendarBadge, calendarLegend, isJobFieldsEnabled, jobFieldDefs, jobFieldValues } from '../deliveries/job-fields';
import { CalendarNoteView, CalendarNotesService } from './calendar-notes.service';

export const JOBS_CALENDAR_FLAG = 'enableJobsCalendar';
const SITECLOCK_TTL_MS = 60_000;
const CACHE_MAX = 200;

export interface JobsCalendarResponse {
  from: string;
  to: string;
  timezone: string;
  events: CalendarEvent[];
  /** off = no enabled SiteClock connection; unavailable = SiteClock didn't answer (AIMS events only). */
  siteclock: { state: 'ok' | 'off' | 'unavailable'; error?: string; fetchedAt?: string };
  /** Custom job fields (enableJobFields): what each event icon means (absent without the flag). */
  legend?: ReturnType<typeof calendarLegend>;
  /** WCT calendar add (enableWctOrders + enableJobsCalendar): the notes overlapping the range (absent otherwise). */
  notes?: CalendarNoteView[];
}

/**
 * GET /dashboard/jobs-calendar (enableJobsCalendar orgs). AIMS runs are read
 * fresh on every call (Delivery(organizationId, scheduledFor) index); the
 * SiteClock feed is cached 60 s per org + range so paging back and forth
 * doesn't hit SiteClock each time. A SiteClock failure never fails the call.
 */
@Injectable()
export class JobsCalendarService {
  private readonly logger = new Logger(JobsCalendarService.name);
  private cache = new Map<string, { at: number; jobs: CalendarSiteClockJob[] | null }>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly siteclock?: SiteClockLinkService,
    @Optional() private readonly notes?: CalendarNotesService,
  ) {}

  async get(organizationId: string, from: string, to: string): Promise<JobsCalendarResponse> {
    if (!(await isOrgFeatureEnabled(this.prisma, organizationId, JOBS_CALENDAR_FLAG))) {
      throw new NotFoundException('The jobs calendar is not enabled for this organisation');
    }
    const bad = checkRange(from, to);
    if (bad) throw new BadRequestException(bad);

    const [runs, sc, notes] = await Promise.all([
      this.runs(organizationId, from, to),
      this.siteclockJobs(organizationId, from, to),
      this.notes ? this.notes.inRange(organizationId, from, to) : Promise.resolve(null),
    ]);
    // Calendar add on (notes is not null): jobs show PTW and an "Untagged" mark when they have no order.
    if (notes) for (const r of runs as any[]) r.untagged = !r.order;
    else for (const r of runs as any[]) delete r.ptw;
    const links = runs.length
      ? await this.prisma.deliverySiteClockJob.findMany({
          where: { organizationId, deliveryId: { in: runs.map((r) => r.id) } },
          select: { deliveryId: true, workerName: true, durationMin: true, externalRef: true },
        })
      : [];
    // Custom job fields: each run's icons + the legend.
    let legend: ReturnType<typeof calendarLegend> | undefined;
    if (runs.length && (await isJobFieldsEnabled(this.prisma, organizationId))) {
      const defs = await jobFieldDefs(this.prisma, organizationId);
      const values = await jobFieldValues(this.prisma, organizationId, runs.map((r) => r.id), defs);
      for (const r of runs as any[]) {
        const v = values.get(r.id) ?? {};
        r.badges = defs.map((f) => calendarBadge(f, v[f.id])).filter(Boolean);
      }
      legend = calendarLegend(defs);
    }
    return {
      from,
      to,
      timezone: CALENDAR_TZ,
      events: buildCalendarEvents(runs, links, sc.jobs),
      siteclock: sc.status,
      ...(legend ? { legend } : {}),
      ...(notes ? { notes } : {}),
    };
  }

  private async runs(organizationId: string, from: string, to: string) {
    const rows: any[] = await runAsOrg(organizationId, () =>
      this.prisma.delivery.findMany({
        where: { organizationId, isDraft: false, scheduledFor: rangeInstants(from, to) },
        select: {
          id: true,
          deliveryNumber: true,
          direction: true,
          status: true,
          scheduledFor: true,
          riderUserId: true,
          riderName: true,
          siteAddress: true,
          customer: { select: { name: true } },
          project: { select: { name: true } },
          order: { select: { id: true, orderNumber: true } },
          verificationState: true,
          ptwStatus: true,
          ptwRemark: true,
          items: { where: { assetClass: 'SERVICE' }, select: { id: true }, take: 1 },
        },
        orderBy: { scheduledFor: 'asc' },
      }),
    );
    const dos = await this.runDos(organizationId, rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      deliveryNumber: r.deliveryNumber,
      direction: r.direction,
      status: r.status,
      scheduledFor: r.scheduledFor,
      riderUserId: r.riderUserId ?? null,
      riderName: r.riderName ?? null,
      siteAddress: r.siteAddress ?? null,
      customerName: r.customer?.name ?? null,
      projectName: r.project?.name ?? null,
      service: (r.items?.length ?? 0) > 0,
      deliveryOrder: dos.get(r.id) ?? null,
      order: r.order ?? null,
      verificationState: r.verificationState ?? null,
      ptw: r.ptwStatus ? { status: r.ptwStatus, remark: r.ptwRemark ?? null } : null,
    }));
  }

  /** Each run's Delivery Order (first DO its lines point at): number, status, template, cancelled mark. */
  private async runDos(organizationId: string, runIds: string[]) {
    const out = new Map<string, { id: string; name: string | null; status: string; templateId: string; cancelled: boolean }>();
    if (!runIds.length) return out;
    const items: any[] = await runAsOrg(organizationId, () =>
      this.prisma.deliveryItem.findMany({ where: { deliveryId: { in: runIds }, documentId: { not: null } }, select: { deliveryId: true, documentId: true } }),
    );
    const docIds = [...new Set(items.map((i) => i.documentId as string))];
    if (!docIds.length) return out;
    const docs: any[] = await runAsOrg(organizationId, () =>
      this.prisma.document.findMany({
        where: { id: { in: docIds }, organizationId, type: { in: ['DELIVERY_ORDER', 'DO'] } },
        select: { id: true, name: true, status: true, documentTemplateId: true, config: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    for (const d of docs) {
      for (const i of items) {
        if (i.documentId !== d.id || out.has(i.deliveryId)) continue;
        out.set(i.deliveryId, { id: d.id, name: d.name ?? null, status: d.status, templateId: d.documentTemplateId, cancelled: (d.config as any)?.cancelled === true });
      }
    }
    return out;
  }

  private async siteclockJobs(organizationId: string, from: string, to: string): Promise<{ jobs: CalendarSiteClockJob[] | null; status: JobsCalendarResponse['siteclock'] }> {
    if (!this.siteclock) return { jobs: null, status: { state: 'off' } };
    const key = `${organizationId}|${from}|${to}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < SITECLOCK_TTL_MS) {
      return { jobs: hit.jobs, status: hit.jobs ? { state: 'ok', fetchedAt: new Date(hit.at).toISOString() } : { state: 'off' } };
    }
    try {
      const jobs = await this.siteclock.calendarJobs(organizationId, from, to);
      this.remember(key, jobs);
      return { jobs, status: jobs ? { state: 'ok', fetchedAt: new Date().toISOString() } : { state: 'off' } };
    } catch (e: any) {
      // Not cached: the next call tries SiteClock again.
      this.logger.warn(`SiteClock calendar for ${organizationId} ${from}..${to}: ${e?.message}`);
      return { jobs: null, status: { state: 'unavailable', error: e?.message || 'SiteClock did not answer' } };
    }
  }

  private remember(key: string, jobs: CalendarSiteClockJob[] | null) {
    if (this.cache.size >= CACHE_MAX) {
      const now = Date.now();
      for (const [k, v] of this.cache) if (now - v.at >= SITECLOCK_TTL_MS) this.cache.delete(k);
      if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    }
    this.cache.set(key, { at: Date.now(), jobs });
  }
}
