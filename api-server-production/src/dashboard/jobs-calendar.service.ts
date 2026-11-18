import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { isOrgFeatureEnabled } from '../common/org-features';
import { SiteClockLinkService } from '../siteclock/siteclock-link.service';
import { buildCalendarEvents, CalendarEvent, CalendarRun, CalendarSiteClockJob, CALENDAR_TZ, checkRange, rangeInstants, stripLinks } from './jobs-calendar';
import { GroupOrg, groupReadScope, memberOrgIds } from '../organizations/org-group';
import { calendarBadge, calendarLegend, isJobFieldsEnabled, jobFieldDefs, jobFieldValues } from '../deliveries/job-fields';
import { jobCategoryDef, jobCategoryValues } from '../deliveries/job-category';
import { CalendarNoteView, CalendarNotesService } from './calendar-notes.service';
import { CalendarStyleService } from './calendar-style.service';
import { resolveSalespersonIds, salespersonAliases } from '../sales-report/salesperson-resolver';
import { CALENDAR_STYLE_LEGEND, CalendarColours, StyleInput, mergeColours, quotationSalesmanCode, salespersonFromCode, styleOf } from './calendar-style';
import { jobStyleValues } from '../deliveries/job-style';
import { isCompletedDo } from './calendar-style';

export const JOBS_CALENDAR_FLAG = 'enableJobsCalendar';
/**
 * Hide SiteClock jobs (WCT group 2026-11-18, default off): the calendar shows
 * only jobs made in AIMS. Every SiteClock-created job (no "aims-delivery:" ref)
 * is dropped; an AIMS job pushed to SiteClock stays, with its crew merged in.
 * The SiteClock feed is only fetched when a job in range was pushed there.
 * The viewing org's flag decides for its whole calendar, group children too.
 */
export const HIDE_SITECLOCK_JOBS_FLAG = 'hideSiteClockJobs';
/**
 * HQ view (WCT group 2026-11-18, default off): the calendar is an HQ view. Every
 * user with the calendar (dashboard:read) already sees every job and note of the
 * org (and of its children with the group calendar); nothing is filtered per user
 * or role. The flag adds `hqView: true` to the response, which turns on the
 * portal's Salesperson filter (client side, over `event.salesperson`).
 */
export const CALENDAR_HQ_VIEW_FLAG = 'calendarHqView';
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
  /** Group calendar (enableGroupCalendar, parent org with children): the orgs shown, own org first (absent otherwise). */
  group?: { orgs: GroupOrg[] };
  /** Calendar style (enableCalendarStyle, WCT group): events carry `style`; the legend is icons only (absent otherwise). */
  style?: { legend: typeof CALENDAR_STYLE_LEGEND };
  /** hideSiteClockJobs on: SiteClock-created jobs are left out (absent otherwise). */
  siteclockJobsHidden?: true;
  /** calendarHqView on: the portal offers the Salesperson filter (absent otherwise). */
  hqView?: true;
}

/** Calendar style for one org's part: on, plus (group calendar child) the parent's colours, which win. */
type StyleCtx = { parent: CalendarColours | null } | null;

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
    @Optional() private readonly style?: CalendarStyleService,
  ) {}

  async get(organizationId: string, from: string, to: string, viewer?: { userId?: string | null }): Promise<JobsCalendarResponse> {
    if (!(await isOrgFeatureEnabled(this.prisma, organizationId, JOBS_CALENDAR_FLAG))) {
      throw new NotFoundException('The jobs calendar is not enabled for this organisation');
    }
    const bad = checkRange(from, to);
    if (bad) throw new BadRequestException(bad);

    // Calendar style (enableCalendarStyle): this org's flag decides for its own items and its children's.
    const styleOn = this.style ? await this.style.enabled(organizationId) : false;
    const ownColours = styleOn ? await this.style!.colours(organizationId) : null;
    const hideSc = await isOrgFeatureEnabled(this.prisma, organizationId, HIDE_SITECLOCK_JOBS_FLAG);
    const [own, scope] = await Promise.all([
      this.orgCalendar(organizationId, from, to, styleOn ? { parent: null } : null, ownColours, hideSc),
      groupReadScope(this.prisma, organizationId, 'jobsCalendar'),
    ]);
    const hq = await isOrgFeatureEnabled(this.prisma, organizationId, CALENDAR_HQ_VIEW_FLAG);
    const withHq = (r: JobsCalendarResponse): JobsCalendarResponse => (hq ? { ...r, hqView: true } : r);
    // Gate off (or no children): exactly the org's own calendar.
    if (!scope.group) return withHq(own);
    return withHq(await this.withGroup(organizationId, own, scope.orgs, from, to, viewer?.userId ?? null, styleOn ? { parent: ownColours } : null, hideSc));
  }

  /**
   * Group calendar (enableGroupCalendar on a parent org): its own calendar plus
   * each child org's jobs and notes, read only, every item named with its org.
   * A child's item opens only for a member of that child (membership + role);
   * for anyone else its links are stripped. Notes join only when the parent has
   * calendar notes itself (else the parent's add buttons would appear).
   */
  private async withGroup(
    organizationId: string,
    own: JobsCalendarResponse,
    orgs: GroupOrg[],
    from: string,
    to: string,
    userId: string | null,
    style: StyleCtx = null,
    hideSc = false,
  ): Promise<JobsCalendarResponse> {
    const children = orgs.filter((o) => o.id !== organizationId);
    const ownName = orgs.find((o) => o.id === organizationId)?.name ?? '';
    const [parts, members] = await Promise.all([
      // Calendar style on the parent: children's items are styled too (parent's colours first).
      Promise.all(children.map((c) => runAsOrg(c.id, () => this.orgCalendar(c.id, from, to, style, null, hideSc)))),
      memberOrgIds(this.prisma, userId, children.map((c) => c.id)),
    ]);
    const tag = <T extends object>(x: T, org: GroupOrg): T => {
      if (org.id === organizationId) return { ...x, orgId: org.id, orgName: ownName };
      const t: any = { ...x, orgId: org.id, orgName: org.name, foreign: true };
      return t;
    };
    const seen = new Set<string>();
    const events: CalendarEvent[] = [];
    const add = (e: CalendarEvent, org: GroupOrg) => {
      if (seen.has(e.id)) return;
      seen.add(e.id);
      let t = tag(e, org);
      if (org.id !== organizationId && !members.has(org.id)) t = { ...stripLinks(t), viewOnly: true };
      events.push(t);
    };
    for (const e of own.events) add(e, { id: organizationId, name: ownName });
    children.forEach((c, i) => parts[i].events.forEach((e) => add(e, c)));
    events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));

    let notes = own.notes;
    if (notes) {
      notes = [
        ...notes.map((n) => tag(n, { id: organizationId, name: ownName })),
        ...children.flatMap((c, i) => (parts[i].notes ?? []).map((n) => tag(n, c))),
      ];
    }
    const states = [own.siteclock, ...parts.map((p) => p.siteclock)];
    const siteclock = states.find((s) => s.state === 'unavailable') ?? own.siteclock;
    return {
      ...own,
      events,
      siteclock,
      ...(notes ? { notes } : {}),
      group: { orgs: orgs.map((o) => (o.id === organizationId ? { id: o.id, name: ownName } : o)) },
    };
  }

  /** One org's calendar: its AIMS runs, its own SiteClock jobs (its own connection only) and its notes. */
  private async orgCalendar(
    organizationId: string,
    from: string,
    to: string,
    style: StyleCtx = null,
    ownColours: CalendarColours | null = null,
    hideSc = false,
  ): Promise<JobsCalendarResponse> {
    // hideSiteClockJobs: the SiteClock feed waits for the links below and is skipped when no job in range was pushed there.
    const [runs, scLoaded, notes] = await Promise.all([
      this.runs(organizationId, from, to),
      hideSc ? Promise.resolve(null) : this.siteclockJobs(organizationId, from, to),
      this.notes ? this.notes.inRange(organizationId, from, to) : Promise.resolve(null),
    ]);
    // Calendar style: each run's PTW status as stored (the event's ptw is dropped below when calendar add is off).
    const ptwOf = new Map((runs as any[]).map((r) => [r.id as string, (r.ptw?.status ?? null) as string | null]));
    // Calendar add on (notes is not null): jobs show PTW and an "Untagged" mark when they have no order.
    if (notes) for (const r of runs as any[]) r.untagged = !r.order;
    else for (const r of runs as any[]) delete r.ptw;
    // Calendar add on: each job's quotation (the order's, else the quick job's own) for the panel's QO link.
    if (notes) await this.attachQuotations(organizationId, runs as any[]);
    const quotationIds = new Map((runs as any[]).map((r) => [r.id as string, (r.quotationId ?? null) as string | null]));
    for (const r of runs as any[]) delete r.quotationId;
    const links = runs.length
      ? await this.prisma.deliverySiteClockJob.findMany({
          where: { organizationId, deliveryId: { in: runs.map((r) => r.id) } },
          select: { deliveryId: true, workerName: true, durationMin: true, externalRef: true },
        })
      : [];
    let sc = scLoaded;
    if (!sc) sc = links.length ? await this.siteclockJobs(organizationId, from, to) : { jobs: null, status: { state: 'off' as const } };
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
      // Job category (WCT group; null elsewhere): each job's, blank = the default.
      const catDef = await jobCategoryDef(this.prisma, organizationId);
      if (catDef) {
        const cats = await jobCategoryValues(this.prisma, organizationId, catDef, runs.map((r) => r.id));
        for (const r of runs as any[]) r.category = cats.get(r.id) ?? catDef.defaultValue;
      }
    }
    let events = buildCalendarEvents(runs, links, sc.jobs, { aimsOnly: hideSc });
    if (style) {
      const colours = mergeColours(ownColours ?? (await this.style!.colours(organizationId)), style.parent);
      events = await this.styled(organizationId, events, runs as any[], ptwOf, quotationIds, colours);
    }
    return {
      from,
      to,
      timezone: CALENDAR_TZ,
      events,
      siteclock: sc.status,
      ...(legend ? { legend } : {}),
      ...(notes ? { notes } : {}),
      ...(style ? { style: { legend: CALENDAR_STYLE_LEGEND } } : {}),
      ...(hideSc ? { siteclockJobsHidden: true as const } : {}),
    };
  }

  /**
   * Calendar style (enableCalendarStyle): each event's fill (salesperson),
   * bar (PTW applicant) and icons, plus the people for the panel. Salesperson:
   * the job's own pick, else its quotation's salesman code (the order's
   * quotation, else a quick job's own). Cancelled and postponed jobs come back
   * greyed, never dropped. SiteClock jobs: neutral fill, cancelled icon only.
   */
  private async styled(
    organizationId: string,
    events: CalendarEvent[],
    runs: Array<{ id: string; status: string }>,
    ptwOf: Map<string, string | null>,
    quotationIds: Map<string, string | null>,
    colours: CalendarColours,
  ): Promise<CalendarEvent[]> {
    const ids = runs.map((r) => r.id);
    const qIds = [...new Set([...quotationIds.values()].filter((x): x is string => !!x))];
    const [meta, doCounts, codes, quotes, aliases] = await Promise.all([
      jobStyleValues(this.prisma, organizationId, ids),
      this.runDoCounts(organizationId, ids),
      this.style!.salesmanCodes(organizationId),
      qIds.length
        ? runAsOrg(organizationId, () => this.prisma.document.findMany({ where: { id: { in: qIds }, organizationId }, select: { id: true, config: true } }))
        : Promise.resolve([] as any[]),
      // Imported quotations' free-text salesperson (WCT group): the org's alias map (src/sales-report).
      salespersonAliases(this.prisma, organizationId),
    ]);
    const codeOfQuote = new Map((quotes as any[]).map((q) => [q.id as string, quotationSalesmanCode(q.config)]));
    const salesOf = new Map<string, string | null>();
    for (const id of ids) {
      const own = meta.get(id)?.salespersonId ?? null;
      const q = quotationIds.get(id);
      const raw = q ? codeOfQuote.get(q) ?? null : null;
      // Code first (as before), then the shared resolver's alias map; several names = the first listed user.
      salesOf.set(id, own ?? salespersonFromCode(raw, codes) ?? (resolveSalespersonIds(raw, { codes, aliases })[0] ?? null));
    }
    const people = new Set<string>();
    for (const id of ids) {
      const s = salesOf.get(id);
      if (s) people.add(s);
      const a = meta.get(id)?.ptwApplicantId;
      if (a) people.add(a);
    }
    const names = await this.style!.names(people);
    const nameOf = (id: string | null, stored: string | null | undefined) => (id ? names.get(id)?.name ?? stored ?? null : null);

    return events.map((e) => {
      const runId = e.source === 'aims' && e.id.startsWith('aims:') ? e.id.slice(5) : null;
      if (!runId) {
        const input: StyleInput = { cancelled: e.cancelled, postponed: false, ptwStatus: null, doCount: 0, cod: false, category: null, salespersonId: null, ptwApplicantId: null };
        return { ...e, style: styleOf(input, colours) };
      }
      const m = meta.get(runId);
      const ptwStatus = ptwOf.get(runId) ?? null;
      const salespersonId = salesOf.get(runId) ?? null;
      const ptwNeeded = !!ptwStatus && ptwStatus !== 'NOT_NEEDED';
      // The applicant stored on the job when it was saved (2026-11-18); the default applicant is never applied at
      // render, so changing it does not recolour old jobs. A PTW job with none stored gets the neutral bar.
      const applicantId = ptwNeeded ? m?.ptwApplicantId ?? null : null;
      const postponed = !!m?.postponed && !e.cancelled;
      const input: StyleInput = {
        cancelled: e.cancelled,
        postponed,
        ptwStatus,
        doCount: doCounts.get(runId) ?? 0,
        cod: !!m?.cod,
        category: e.category ?? null,
        salespersonId,
        ptwApplicantId: applicantId,
      };
      const salesName = nameOf(salespersonId, m?.salespersonId === salespersonId ? m?.salespersonName : null);
      const applicantName = nameOf(applicantId, m?.ptwApplicantName);
      return {
        ...e,
        ...(postponed ? { statusLabel: 'Postponed' } : {}),
        postponed,
        cod: !!m?.cod,
        doCount: input.doCount,
        salesperson: salespersonId ? { id: salespersonId, name: salesName } : null,
        ptwApplicant: applicantId ? { id: applicantId, name: applicantName } : null,
        style: styleOf(input, colours),
      };
    });
  }

  /** Calendar style: each run's completed (signed) DOs, counted once each; drafts and cancelled DOs don't count. */
  private async runDoCounts(organizationId: string, runIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!runIds.length) return out;
    const items: any[] = await runAsOrg(organizationId, () =>
      this.prisma.deliveryItem.findMany({ where: { deliveryId: { in: runIds }, documentId: { not: null } }, select: { deliveryId: true, documentId: true } }),
    );
    const docIds = [...new Set(items.map((i) => i.documentId as string))];
    if (!docIds.length) return out;
    const docs: any[] = await runAsOrg(organizationId, () =>
      this.prisma.document.findMany({ where: { id: { in: docIds }, organizationId, type: { in: ['DELIVERY_ORDER', 'DO'] } }, select: { id: true, status: true, config: true } }),
    );
    const live = new Set(docs.filter((d) => isCompletedDo(d)).map((d) => d.id as string));
    const per = new Map<string, Set<string>>();
    for (const i of items) {
      if (!live.has(i.documentId)) continue;
      const set = per.get(i.deliveryId) ?? new Set<string>();
      set.add(i.documentId);
      per.set(i.deliveryId, set);
    }
    for (const [k, v] of per) out.set(k, v.size);
    return out;
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
          scheduledAllDay: true,
          riderUserId: true,
          riderName: true,
          siteAddress: true,
          customer: { select: { name: true } },
          project: { select: { name: true } },
          order: { select: { id: true, orderNumber: true, sourceQuotationId: true } },
          sourceQuotationId: true,
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
      scheduledAllDay: !!r.scheduledAllDay,
      riderUserId: r.riderUserId ?? null,
      riderName: r.riderName ?? null,
      siteAddress: r.siteAddress ?? null,
      customerName: r.customer?.name ?? null,
      projectName: r.project?.name ?? null,
      service: (r.items?.length ?? 0) > 0,
      deliveryOrder: dos.get(r.id) ?? null,
      order: r.order ? { id: r.order.id, orderNumber: r.order.orderNumber } : null,
      quotationId: (r.order?.sourceQuotationId ?? r.sourceQuotationId ?? null) as string | null,
      verificationState: r.verificationState ?? null,
      ptw: r.ptwStatus ? { status: r.ptwStatus, remark: r.ptwRemark ?? null } : null,
    }));
  }

  /** WCT calendar add: each run's quotation (number, type, template) from its quotationId. */
  private async attachQuotations(organizationId: string, runs: Array<{ quotationId?: string | null; quotation?: CalendarRun['quotation'] }>) {
    const ids = [...new Set(runs.map((r) => r.quotationId).filter((x): x is string => !!x))];
    if (!ids.length) return;
    const docs: any[] = await runAsOrg(organizationId, () =>
      this.prisma.document.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, name: true, type: true, documentTemplateId: true } }),
    );
    const by = new Map(docs.map((d) => [d.id, d]));
    for (const r of runs) {
      const d = r.quotationId ? by.get(r.quotationId) : null;
      if (d) r.quotation = { id: d.id, name: d.name ?? null, type: d.type, templateId: d.documentTemplateId ?? null };
    }
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
