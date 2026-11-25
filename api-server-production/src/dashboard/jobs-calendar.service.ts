import { applicantView } from '../deliveries/ptw-applicants';
import { isCalendarAddEnabled } from '../deliveries/quick-jobs';
import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { isOrgFeatureEnabled } from '../common/org-features';
import { SiteClockLinkService } from '../siteclock/siteclock-link.service';
import { buildCalendarEvents, CalendarEvent, CalendarHoliday, CalendarRun, CalendarSiteClockJob, CALENDAR_TZ, checkRange, chipLabelOf, holidaysInRange, rangeInstants, stripLinks } from './jobs-calendar';
import { GroupOrg, groupJobCompanies, groupReadScope, memberOrgIds } from '../organizations/org-group';
import { calendarBadge, calendarLegend, isJobFieldsEnabled, jobFieldDefs, jobFieldValues } from '../deliveries/job-fields';
import { jobCategoryDef, jobCategoryValues } from '../deliveries/job-category';
import { CalendarNoteView, CalendarNotesService } from './calendar-notes.service';
import { quotationIndex } from '../deliveries/quotation-search-index';
import { CalendarSearchHit, SEARCH_LIMIT, orderHits, searchOrg } from './jobs-calendar-search';
import { CalendarStyleService } from './calendar-style.service';
import { resolveSalespersonIds, salespersonAliases } from '../sales-report/salesperson-resolver';
import { CALENDAR_STYLE_LEGEND, CalendarColours, StyleInput, mergeColours, quotationSalesmanCode, salespersonFromCode, styleOf } from './calendar-style';
import { jobCreatorIds, jobStyleValues } from '../deliveries/job-style';
import type { PanelPerson } from './calendar-style';
import { isLiveDo, ptwStripeLegend, withPanelFills } from './calendar-style';
import { quotationStatusLabel } from '../orders/quotation-status-label';
import { crewText } from '../deliveries/job-style';
import { withSingapore } from '../common/sg-address';
import { currentCrewNames } from '../workers-teams/crew';
import { quotationSubjectOf } from '../deliveries/quick-job-quotation';
import { isTsv, tsvEvent } from './calendar-note-types';
import { CalendarSeriesService, RepeatView, SeriesRow, occurrenceId, sgInstant } from './calendar-series.service';
import { addDays, daysBetween } from './recurrence';

/** A repeating job's occurrence id ("<templateId>~<yyyyMMdd>") -> the template's id; any other id unchanged. */
const baseRunId = (id: string) => id.split('~')[0];
const isVirtualId = (id: string) => id.includes('~');
const SG_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: CALENDAR_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const SG_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: CALENDAR_TZ, hour: '2-digit', minute: '2-digit', hour12: false });

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
  style?: { legend: typeof CALENDAR_STYLE_LEGEND; stripes?: Array<{ label: string; colour: string }> };
  /** hideSiteClockJobs on: SiteClock-created jobs are left out (absent otherwise). */
  siteclockJobsHidden?: true;
  /** calendarHqView on: the portal offers the Salesperson filter (absent otherwise). */
  hqView?: true;
  /**
   * Calendar style (WCT group, 2026-11-19): the people list beside the calendar. Everyone who made a job or note in
   * this org plus every Sales member, with their colour. Each own-org event / note carries `createdBy`; unticking a
   * person hides what they created. Absent for every other org.
   */
  people?: PanelPerson[];
  /** Calendar style (WCT group, 2026-11-24): public holidays in the range, from the Field public holidays table (absent otherwise). */
  holidays?: CalendarHoliday[];
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
    @Optional() private readonly series?: CalendarSeriesService,
  ) {}

  /** Group New job (WCT 2026-11-22): the companies a new job can go under (org-group.ts groupJobCompanies). */
  async companies(organizationId: string, userId: string | null, isAdmin: boolean) {
    const out: any = await groupJobCompanies(this.prisma, organizationId, userId, isAdmin);
    // 2026-11-25 (YMM has the calendar but no Orders yet): a company that can't take a new job (isCalendarAddEnabled:
    // enableWctOrders + enableJobsCalendar) is left out of the Organisation pick, so nobody hits a failed create. Its
    // jobs still show on the group calendar. The calendar's own company always stays.
    if (Array.isArray(out?.orgs) && out.orgs.length) {
      const ok = await Promise.all(out.orgs.map((o: any) => (o?.id === organizationId ? true : isCalendarAddEnabled(this.prisma, o.id))));
      out.orgs = out.orgs.filter((_: any, i: number) => ok[i]);
    }
    // The New job form is opening: warm each listed company's quotation search in the background (2026-11-23).
    for (const o of Array.isArray(out?.orgs) ? out.orgs : []) if (o?.id) quotationIndex.warm(this.prisma, o.id);
    return out;
  }

  async get(organizationId: string, from: string, to: string, viewer?: { userId?: string | null }): Promise<JobsCalendarResponse> {
    if (!(await isOrgFeatureEnabled(this.prisma, organizationId, JOBS_CALENDAR_FLAG))) {
      throw new NotFoundException('The jobs calendar is not enabled for this organisation');
    }
    const bad = checkRange(from, to);
    if (bad) throw new BadRequestException(bad);

    // Calendar speed (2026-11-25): the reads below that do not depend on each other run side by side (the same reads
    // and the same response as before; each round trip used to wait for the one before it).
    // Calendar style (enableCalendarStyle): this org's flag decides for its own items and its children's.
    const [styleOn, hideSc, hq, scope] = await Promise.all([
      this.style ? this.style.enabled(organizationId) : Promise.resolve(false),
      isOrgFeatureEnabled(this.prisma, organizationId, HIDE_SITECLOCK_JOBS_FLAG),
      isOrgFeatureEnabled(this.prisma, organizationId, CALENDAR_HQ_VIEW_FLAG),
      groupReadScope(this.prisma, organizationId, 'jobsCalendar'),
    ]);
    // WCT group (2026-11-23): read this company's quotations for the New job search now, in the background.
    if (styleOn) quotationIndex.warm(this.prisma, organizationId);
    // Round 39: the people list first, so each chip takes its salesperson's People panel colour (automatic ones too).
    const [people, baseColours] = styleOn ? await Promise.all([this.people(organizationId), this.style!.colours(organizationId)]) : [null, null];
    const ownColours = styleOn ? withPanelFills(baseColours!, people) : null;
    const [own, holidays, group] = await Promise.all([
      this.orgCalendar(organizationId, from, to, styleOn ? { parent: null } : null, ownColours, hideSc),
      styleOn ? this.holidays([organizationId, ...(scope.group ? scope.orgs.map((o) => o.id) : [])], from, to) : Promise.resolve(null),
      // Group calendar: the children's parts are read alongside the org's own.
      scope.group ? this.groupParts(organizationId, scope.orgs, from, to, viewer?.userId ?? null, styleOn ? { parent: ownColours } : null, hideSc) : Promise.resolve(null),
    ]);
    const withHq = (r: JobsCalendarResponse): JobsCalendarResponse => {
      const out = hq ? { ...r, hqView: true as const } : r;
      const withPeople = people ? { ...out, people } : out;
      return holidays ? { ...withPeople, holidays } : withPeople;
    };
    // Gate off (or no children): exactly the org's own calendar.
    if (!scope.group || !group) return withHq(own);
    return withHq(this.withGroup(organizationId, own, scope.orgs, group));
  }

  /**
   * Jobs calendar search (WCT group, enableGroupCalendar, 2026-11-23): the companies this calendar shows (the group's,
   * or the org alone), narrowed to the Companies filter; every date; 20 at most (jobs-calendar-search.ts).
   */
  async search(organizationId: string, rawQ: string, companies: string[] = []): Promise<{ results: CalendarSearchHit[] }> {
    if (!(await isOrgFeatureEnabled(this.prisma, organizationId, 'enableGroupCalendar'))) throw new NotFoundException('Calendar search is not enabled for this organisation');
    const q = String(rawQ ?? '').trim().slice(0, 80);
    if (q.length < 2) return { results: [] };
    const scope = await groupReadScope(this.prisma, organizationId, 'jobsCalendar');
    const own = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    let orgs: Array<{ id: string; name: string }> = scope.group ? scope.orgs.map((o) => ({ id: o.id, name: o.id === organizationId ? own?.name ?? o.name : o.name })) : [{ id: organizationId, name: own?.name ?? '' }];
    if (companies.length) orgs = orgs.filter((o) => companies.includes(o.id));
    const parts = await Promise.all(orgs.map((o) => searchOrg(this.prisma, o, q)));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: CALENDAR_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return { results: orderHits(parts.flat(), today).slice(0, SEARCH_LIMIT) };
  }

  /**
   * Calendar style (2026-11-24): public holidays in the range from the Field module's table (FieldPublicHoliday), the
   * viewing org's rows first, then its group's. Never fails the calendar (null = left out).
   */
  private async holidays(orgIds: string[], from: string, to: string): Promise<CalendarHoliday[] | null> {
    try {
      const ids = [...new Set(orgIds)];
      const rows = await Promise.all(
        ids.map((id) => runAsOrg(id, () => this.prisma.fieldPublicHoliday.findMany({ where: { organizationId: id, date: { gte: from, lte: to } }, select: { date: true, name: true } }))),
      );
      return holidaysInRange(rows.flat(), from, to);
    } catch (err: any) {
      this.logger.warn(`holidays: ${err?.message}`);
      return null;
    }
  }

  /** Calendar style: the people list (job and note creators of this org, plus its Sales members). */
  private async people(organizationId: string): Promise<PanelPerson[]> {
    const [jobs, notes] = await Promise.all([jobCreatorIds(this.prisma, organizationId), this.notes ? this.notes.creatorIds(organizationId) : Promise.resolve([] as string[])]);
    return this.style!.panel(organizationId, new Set([...jobs, ...notes]));
  }

  /** Group calendar: each child org's part and the children the viewer is a member of (read before the merge). */
  private async groupParts(
    organizationId: string,
    orgs: GroupOrg[],
    from: string,
    to: string,
    userId: string | null,
    style: StyleCtx = null,
    hideSc = false,
  ): Promise<{ parts: JobsCalendarResponse[]; members: Set<string> }> {
    const children = orgs.filter((o) => o.id !== organizationId);
    const [parts, members] = await Promise.all([
      // Calendar style on the parent: children's items are styled too (parent's colours first).
      Promise.all(children.map((c) => runAsOrg(c.id, () => this.orgCalendar(c.id, from, to, style, null, hideSc)))),
      memberOrgIds(this.prisma, userId, children.map((c) => c.id)),
    ]);
    return { parts, members };
  }

  /**
   * Group calendar (enableGroupCalendar on a parent org): its own calendar plus
   * each child org's jobs and notes, read only, every item named with its org.
   * A child's item opens only for a member of that child (membership + role);
   * for anyone else its links are stripped. Notes join only when the parent has
   * calendar notes itself (else the parent's add buttons would appear).
   */
  private withGroup(organizationId: string, own: JobsCalendarResponse, orgs: GroupOrg[], read: { parts: JobsCalendarResponse[]; members: Set<string> }): JobsCalendarResponse {
    const children = orgs.filter((o) => o.id !== organizationId);
    const ownName = orgs.find((o) => o.id === organizationId)?.name ?? '';
    const { parts, members } = read;
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
    // Calendar speed (2026-11-25): the repeating series are read alongside the range's jobs and notes.
    const [runs, scLoaded, notesRead, seriesRead] = await Promise.all([
      this.runs(organizationId, from, to),
      hideSc ? Promise.resolve(null) : this.siteclockJobs(organizationId, from, to),
      this.notes ? this.notes.inRange(organizationId, from, to) : Promise.resolve(null),
      this.loadSeries(organizationId),
    ]);
    // Repeating jobs and notes (WCT group, 2026-11-25): the range's occurrences, drawn from their templates.
    const rep = await this.repeats(organizationId, from, to, runs as any[], notesRead, seriesRead);
    if (rep) (runs as any[]).push(...rep.runs);
    const notes = rep && notesRead ? rep.notes : notesRead;
    // Calendar style: each run's PTW status as stored (the event's ptw is dropped below when calendar add is off).
    const ptwOf = new Map((runs as any[]).map((r) => [r.id as string, (r.ptw?.status ?? null) as string | null]));
    // Calendar add on (notes is not null): jobs show PTW and an "Untagged" mark when they have no order.
    if (notes) for (const r of runs as any[]) r.untagged = !r.order;
    else for (const r of runs as any[]) delete r.ptw;
    // Calendar speed: the quotations, the SiteClock links and the job fields are independent reads, run side by side.
    const [, links, legend] = await Promise.all([
      // Calendar add on: each job's quotation (the order's, else the quick job's own) for the panel's QO link.
      notes ? this.attachQuotations(organizationId, runs as any[]) : Promise.resolve(),
      runs.length
        ? this.prisma.deliverySiteClockJob.findMany({
            where: { organizationId, deliveryId: { in: runs.map((r) => r.id) } },
            select: { deliveryId: true, workerName: true, durationMin: true, externalRef: true },
          })
        : Promise.resolve([] as Array<{ deliveryId: string; workerName: string | null; durationMin: number; externalRef: string }>),
      // Custom job fields: each run's icons + the legend.
      this.jobFields(organizationId, runs as any[]),
    ]);
    const quotationIds = new Map((runs as any[]).map((r) => [r.id as string, (r.quotationId ?? null) as string | null]));
    for (const r of runs as any[]) delete r.quotationId;
    let sc = scLoaded;
    if (!sc) sc = links.length ? await this.siteclockJobs(organizationId, from, to) : { jobs: null, status: { state: 'off' as const } };
    let events = buildCalendarEvents(runs, links, sc.jobs, { aimsOnly: hideSc });
    if (rep) events = events.map((e) => withRepeat(e, rep.repeatOf, rep.durations));
    let shownNotes = notes;
    let stripes: Array<{ label: string; colour: string }> = [];
    if (style) {
      const colours = mergeColours(ownColours ?? (await this.style!.colours(organizationId)), style.parent);
      // Org Settings > Calendar colours (2026-11-25): the legend lists the PTW stripe colours set per status.
      stripes = ptwStripeLegend(colours);
      events = await this.styled(organizationId, events, runs as any[], ptwOf, quotationIds, colours);
      // Calendar people list: who added each note.
      if (notes?.length && this.notes) {
        const by = await this.notes.creators(organizationId, [...new Set(notes.map((n: CalendarNoteView) => baseRunId(n.id)))] as string[]);
        const names = await this.style!.names(new Set(by.values()));
        shownNotes = notes.map((n) => {
          const id = by.get(baseRunId(n.id)) ?? null;
          return { ...n, createdBy: id ? { id, name: names.get(id)?.name ?? null } : null };
        });
      }
      // Technician Site Visit notes (2026-11-24): drawn exactly like a job (events), not as a note bar.
      if (shownNotes?.some(isTsv)) {
        events = [...events, ...(await this.tsvEvents(shownNotes.filter(isTsv), colours))].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
        shownNotes = shownNotes.filter((n) => !isTsv(n));
      }
    }
    return {
      from,
      to,
      timezone: CALENDAR_TZ,
      events,
      siteclock: sc.status,
      ...(legend ? { legend } : {}),
      ...(shownNotes ? { notes: shownNotes } : {}),
      ...(style ? { style: { legend: CALENDAR_STYLE_LEGEND, ...(stripes.length ? { stripes } : {}) } } : {}),
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
    runs: Array<{ id: string; status: string; customerName?: string | null; siteAddress?: string | null; notes?: string | null }>,
    ptwOf: Map<string, string | null>,
    quotationIds: Map<string, string | null>,
    colours: CalendarColours,
  ): Promise<CalendarEvent[]> {
    const ids = runs.map((r) => r.id);
    const qIds = [...new Set([...quotationIds.values()].filter((x): x is string => !!x))];
    const [metaBase, doCounts, codes, quotes, aliases] = await Promise.all([
      jobStyleValues(this.prisma, organizationId, [...new Set(ids.map(baseRunId))]),
      // A repeating job's occurrences have no DOs of their own (one made into its own job is a real run).
      this.runDoCounts(organizationId, (runs as any[]).filter((r) => !isVirtualId(r.id))),
      this.style!.salesmanCodes(organizationId),
      qIds.length
        ? runAsOrg(organizationId, () => this.prisma.document.findMany({ where: { id: { in: qIds }, organizationId }, select: { id: true, status: true, config: true } }))
        : Promise.resolve([] as any[]),
      // Imported quotations' free-text salesperson (WCT group): the org's alias map (src/sales-report).
      salespersonAliases(this.prisma, organizationId),
    ]);
    const meta = { get: (id: string) => metaBase.get(baseRunId(id)), values: () => metaBase.values() };
    const codeOfQuote = new Map((quotes as any[]).map((q) => [q.id as string, quotationSalesmanCode(q.config)]));
    const quoteOf = new Map((quotes as any[]).map((q) => [q.id as string, q]));
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
      const c = meta.get(id)?.createdById;
      if (c) people.add(c);
    }
    const names = await this.style!.names(people);
    // Round 39 B4: picked teams / workers show their current names (a renamed team reads its new name).
    const crewNames = await currentCrewNames(this.prisma, organizationId, [...meta.values()].flatMap((m) => m.crew ?? []));
    const teamOf = (m: any) => (m ? crewText({ team: m.team ?? null, crew: (m.crew ?? []).map((c: any) => ({ ...c, name: crewNames.get(`${c.kind}:${c.id}`) ?? c.name })) }) : null);
    const nameOf = (id: string | null, stored: string | null | undefined) => (id ? names.get(id)?.name ?? stored ?? null : null);

    const runOf = new Map(runs.map((r) => [r.id, r]));
    return events.map((e) => {
      const runId = e.source === 'aims' && e.id.startsWith('aims:') ? e.id.slice(5) : null;
      if (!runId) {
        const input: StyleInput = { cancelled: e.cancelled, postponed: false, ptwStatus: null, doCount: 0, cod: false, category: null, salespersonId: null, ptwApplicantId: null };
        return { ...e, style: styleOf(input, colours), createdBy: null, chipLabel: e.title };
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
        sticker: !!m?.sticker,
      };
      const salesName = nameOf(salespersonId, m?.salespersonId === salespersonId ? m?.salespersonName : null);
      // PTW applicants list orgs (2026-11-19): the name comes from the list; an applicant not on it is marked.
      const listed = colours.ptwList ? applicantView(colours.ptwList, applicantId, nameOf(applicantId, m?.ptwApplicantName)) : null;
      const applicantName = listed ? listed.name : nameOf(applicantId, m?.ptwApplicantName);
      const run = runOf.get(runId);
      const q = quotationIds.get(runId) ? quoteOf.get(quotationIds.get(runId)!) : null;
      return {
        ...e,
        // Panel + WhatsApp list (2026-11-20).
        customer: run?.customerName?.trim() || null,
        subject: q ? quotationSubjectOf(q.config) : null,
        remarks: run?.notes?.trim() || null,
        team: teamOf(m),
        // Round 39 B4: the picks themselves, for the panel's Team / crew picker (free text stays in teamText).
        crewPicks: (m?.crew ?? []).map((c: any) => ({ ...c, name: crewNames.get(`${c.kind}:${c.id}`) ?? c.name })),
        teamText: m?.team ?? null,
        ptwStatus: ptwStatus || 'NOT_NEEDED',
        quotationStatus: q?.status ?? null,
        // Round 39: the side panel's quotation chip, the real status (never "Imported").
        quotationStatusLabel: q ? quotationStatusLabel(q) || null : null,
        ...(e.cancelled && m?.calendarCancel ? { calendarCancelled: true as const } : {}),
        ...(postponed ? { statusLabel: 'Postponed' } : {}),
        postponed,
        cod: !!m?.cod,
        doCount: input.doCount,
        salesperson: salespersonId ? { id: salespersonId, name: salesName } : null,
        ptwApplicant: applicantId ? { id: listed?.id ?? applicantId, name: applicantName, ...(listed && !listed.inList ? { inList: false } : {}) } : null,
        ...(m?.sticker ? { sticker: true } : {}),
        // Shop name (2026-11-24): the name everywhere when filled, the customer under it in the panel.
        chipLabel: m?.shopName || chipLabelOf(run, e.title),
        ...(m?.shopName ? { shopName: m.shopName } : {}),
        ...(m?.jobTitle ? { jobTitle: m.jobTitle } : {}),
        // Singapore in addresses (2026-11-24): "... 639273" shows as "... Singapore 639273". Display only.
        ...(e.address ? { address: withSingapore(e.address) } : {}),
        // Postpone keeps the old event (2026-11-24): the pair links both ways; the old one is a record only.
        ...(m?.postponedTo ? { postponedTo: m.postponedTo } : {}),
        ...(m?.postponedFrom ? { postponedFrom: m.postponedFrom } : {}),
        ...(m?.recordOnly ? { recordOnly: true as const } : {}),
        createdBy: m?.createdById ? { id: m.createdById, name: names.get(m.createdById)?.name ?? null } : null,
        style: styleOf(input, colours),
      };
    });
  }

  /**
   * Calendar style: Technician Site Visit notes as job events (calendar-note-types.ts tsvEvent). 2026-11-25: the
   * card is the note's time + title; its fill is the People colour of the note's old salesperson (kept, hidden) or,
   * for a note made since, of the person who added it, through the same styleOf the jobs use.
   */
  private async tsvEvents(notes: CalendarNoteView[], colours: CalendarColours): Promise<CalendarEvent[]> {
    return notes.map((n) => {
      const spId = (n.details as any)?.salesperson?.id;
      const colourOf = typeof spId === 'string' ? spId : n.createdBy?.id ?? null;
      const input: StyleInput = { cancelled: false, postponed: false, ptwStatus: null, doCount: 0, cod: false, category: null, salespersonId: colourOf, ptwApplicantId: null };
      return tsvEvent(n, { style: styleOf(input, colours), createdBy: n.createdBy ?? null });
    });
  }

  /**
   * Calendar style ✅ (Elroy 2026-11-20): each job's DOs that are not cancelled or voided, draft or completed, counted
   * once each. A job with no DO of its own counts its order's DOs instead: the AIMS DOs made on the order
   * (config.orderId) and native DOs linked to it (Link existing document). Old ERP DOs imported onto an order are
   * history and never count.
   */
  private async runDoCounts(organizationId: string, runs: Array<{ id: string; order?: { id: string } | null }>): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const runIds = runs.map((r) => r.id);
    if (!runIds.length) return out;
    const items: any[] = await runAsOrg(organizationId, () =>
      this.prisma.deliveryItem.findMany({ where: { deliveryId: { in: runIds }, documentId: { not: null } }, select: { deliveryId: true, documentId: true } }),
    );
    const docIds = [...new Set(items.map((i) => i.documentId as string))];
    const docs: any[] = docIds.length
      ? await runAsOrg(organizationId, () =>
          this.prisma.document.findMany({ where: { id: { in: docIds }, organizationId, type: { in: ['DELIVERY_ORDER', 'DO'] } }, select: { id: true, status: true, config: true } }),
        )
      : [];
    const live = new Set(docs.filter((d) => isLiveDo(d)).map((d) => d.id as string));
    const per = new Map<string, Set<string>>();
    for (const i of items) {
      if (!live.has(i.documentId)) continue;
      const set = per.get(i.deliveryId) ?? new Set<string>();
      set.add(i.documentId);
      per.set(i.deliveryId, set);
    }
    for (const [k, v] of per) out.set(k, v.size);
    // No DO of its own: the order's DOs.
    const orderIds = [...new Set(runs.filter((r) => !out.get(r.id) && r.order?.id).map((r) => r.order!.id))];
    if (orderIds.length) {
      const [orderDocs, orders] = await Promise.all([
        runAsOrg(organizationId, () => orderDoRows(this.prisma, organizationId, orderIds)),
        runAsOrg(organizationId, () => this.prisma.order.findMany({ where: { id: { in: orderIds }, organizationId }, select: { id: true, linkedDocuments: true } })) as Promise<any[]>,
      ]);
      const byOrder = new Map<string, Set<string>>();
      for (const d of orderDocs) {
        const oid = (d.config as any)?.orderId;
        if (!oid || !isLiveDo(d) || (d.config as any)?.erpImport) continue;
        byOrder.set(oid, (byOrder.get(oid) ?? new Set<string>()).add(d.id));
      }
      const linkedIds = new Map<string, string[]>();
      for (const o of orders) {
        const ld: any = o.linkedDocuments || {};
        const ids = (Array.isArray(ld.do) ? ld.do : []).filter((x: any) => x && typeof x.id === 'string' && x.imported !== true).map((x: any) => x.id as string);
        if (ids.length) linkedIds.set(o.id, ids);
      }
      const allLinked = [...new Set([...linkedIds.values()].flat())];
      if (allLinked.length) {
        const linkedDocs: any[] = await runAsOrg(organizationId, () =>
          this.prisma.document.findMany({ where: { id: { in: allLinked }, organizationId, type: { in: ['DELIVERY_ORDER', 'DO'] } }, select: { id: true, config: true } }),
        );
        const ok = new Set(linkedDocs.filter((d) => isLiveDo(d) && !(d.config as any)?.erpImport).map((d) => d.id as string));
        for (const [oid, ids] of linkedIds) for (const id of ids) if (ok.has(id)) byOrder.set(oid, (byOrder.get(oid) ?? new Set<string>()).add(id));
      }
      for (const r of runs) if (!out.get(r.id) && r.order?.id && byOrder.get(r.order.id)?.size) out.set(r.id, byOrder.get(r.order.id)!.size);
    }
    return out;
  }

  /**
   * Repeating jobs and notes (WCT group, 2026-11-25; calendar-series.service.ts): each series' occurrences in
   * from..to as runs / notes drawn from its template ("<templateId>~<yyyyMMdd>"), the templates themselves left out,
   * and the series line ("Repeats: ...") for the occurrences and for those made into their own job / note.
   * null = the org has no repeats (every other org: untouched).
   */
  /** Custom job fields (enableJobFields): each run's icons (and job category) set on the run; the legend (undefined = off). */
  private async jobFields(organizationId: string, runs: any[]): Promise<ReturnType<typeof calendarLegend> | undefined> {
    if (!runs.length || !(await isJobFieldsEnabled(this.prisma, organizationId))) return undefined;
    const ids = [...new Set(runs.map((r) => baseRunId(r.id)))];
    // Calendar speed: the field values and the category are read side by side (same reads as before).
    const [defs, catDef] = await Promise.all([jobFieldDefs(this.prisma, organizationId), jobCategoryDef(this.prisma, organizationId)]);
    const [values, cats] = await Promise.all([
      jobFieldValues(this.prisma, organizationId, ids, defs),
      // Job category (WCT group; null elsewhere): each job's, blank = the default.
      catDef ? jobCategoryValues(this.prisma, organizationId, catDef, ids) : Promise.resolve(null),
    ]);
    for (const r of runs) {
      const v = values.get(baseRunId(r.id)) ?? {};
      r.badges = defs.map((f) => calendarBadge(f, v[f.id])).filter(Boolean);
    }
    if (catDef && cats) for (const r of runs) r.category = cats.get(baseRunId(r.id)) ?? catDef.defaultValue;
    return calendarLegend(defs);
  }

  /** The org's repeating series (null = repeats off for the org). NOTE series are used only when the org has notes. */
  private async loadSeries(organizationId: string): Promise<{ jobS: SeriesRow[]; noteS: SeriesRow[] } | null> {
    if (!this.series || !(await this.series.enabled(organizationId))) return null;
    const [jobS, noteS] = await Promise.all([this.series.seriesOf(organizationId, 'JOB'), this.series.seriesOf(organizationId, 'NOTE')]);
    return { jobS, noteS };
  }

  private async repeats(organizationId: string, from: string, to: string, runs: any[], notes: CalendarNoteView[] | null, loaded: { jobS: SeriesRow[]; noteS: SeriesRow[] } | null) {
    if (!this.series || !loaded) return null;
    const jobS = loaded.jobS;
    const noteS = notes ? loaded.noteS : [];
    if (!jobS.length && !noteS.length) return null;
    const exc = await this.series.exceptionsOf(organizationId, [...jobS, ...noteS].map((s) => s.id));
    const taken = new Map<string, Set<string>>();
    const excByRecord = new Map<string, { seriesId: string; date: string }>();
    for (const e of exc) {
      (taken.get(e.seriesId) ?? taken.set(e.seriesId, new Set()).get(e.seriesId)!).add(e.originalDate);
      if (e.recordId) excByRecord.set(e.recordId, { seriesId: e.seriesId, date: e.originalDate });
    }
    const repeatOf = new Map<string, RepeatView>();
    const durations = new Map<string, number>();
    const anchorOf = new Map<string, string>();
    const outRuns: any[] = [];
    const templates = await this.runs(organizationId, from, to, jobS.map((s) => s.templateId));
    const tBy = new Map(templates.map((t: any) => [t.id as string, t]));
    for (const s of jobS) {
      const t: any = tBy.get(s.templateId);
      if (!t?.scheduledFor) continue;
      const date = SG_DAY.format(t.scheduledFor);
      const time = t.scheduledAllDay ? null : SG_TIME.format(t.scheduledFor).replace(/^24/, '00');
      anchorOf.set(s.id, date);
      for (const d of this.series.expand(s, { date }, from, to, taken.get(s.id) ?? new Set())) {
        const id = occurrenceId(t.id, d);
        outRuns.push({ ...t, id, scheduledFor: sgInstant(d, time), deliveryOrder: null, verificationState: null });
        repeatOf.set(id, this.series.view(s, date, d));
        if (s.durationMin) durations.set(id, s.durationMin);
      }
    }
    let outNotes = notes;
    if (notes) {
      const tIds = new Set(noteS.map((s) => s.templateId));
      const tNotes: any[] = noteS.length
        ? await runAsOrg(organizationId, () =>
            this.prisma.calendarNote.findMany({
              where: { organizationId, id: { in: [...tIds] } },
              select: { id: true, title: true, type: true, staffId: true, staffName: true, startDate: true, endDate: true, allDay: true, startTime: true, endTime: true, remark: true, details: true } as any,
            }),
          )
        : [];
      const nBy = new Map(tNotes.map((n) => [n.id as string, n]));
      outNotes = notes.filter((n) => !tIds.has(n.id));
      for (const s of noteS) {
        const n = nBy.get(s.templateId);
        if (!n) continue;
        const { details, ...rest } = n;
        const span = Math.max(0, daysBetween(n.startDate, n.endDate));
        anchorOf.set(s.id, n.startDate);
        for (const d of this.series.expand(s, { date: n.startDate }, from, to, taken.get(s.id) ?? new Set(), span)) {
          const view = this.series.view(s, n.startDate, d);
          outNotes.push({ ...rest, ...(details ? { details } : {}), id: occurrenceId(n.id, d), startDate: d, endDate: addDays(d, span), repeat: view } as any);
        }
      }
      outNotes.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
    }
    // Occurrences made into their own job / note: they still say which series they belong to.
    const seriesBy = new Map([...jobS, ...noteS].map((s) => [s.id, s]));
    const excView = (recordId: string) => {
      const x = excByRecord.get(recordId);
      const s = x ? seriesBy.get(x.seriesId) : null;
      return x && s ? this.series!.view(s, anchorOf.get(s.id) ?? s.startDate, x.date, true) : null;
    };
    for (const r of runs) {
      const v = excView(r.id);
      if (v) repeatOf.set(r.id, v);
    }
    if (outNotes) outNotes = outNotes.map((n: any) => (n.repeat ? n : excView(n.id) ? { ...n, repeat: excView(n.id) } : n));
    return { runs: outRuns, notes: outNotes ?? [], repeatOf, durations };
  }

  /** ids: the series templates (drafts) instead of the range's jobs. */
  private async runs(organizationId: string, from: string, to: string, ids?: string[]) {
    if (ids && !ids.length) return [];
    const rows: any[] = await runAsOrg(organizationId, () =>
      this.prisma.delivery.findMany({
        where: ids ? { organizationId, id: { in: ids } } : { organizationId, isDraft: false, scheduledFor: rangeInstants(from, to) },
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
          notes: true,
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
      notes: r.notes ?? null,
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

/**
 * The DOs made on these orders (config.orderId), with only the config keys the ✅ count reads (orderId, cancelled,
 * voided, erpImport). Calendar speed (2026-11-25): one `= ANY` over the org's DOs replaces a Prisma OR of one JSON
 * path filter per order, which re-read every DO's config once per order (4 to 6 s for a WCT month, 1.5 MB of
 * configs); same rows (a JSON string orderId equal to one of the ids), about 0.1 s.
 */
export async function orderDoRows(prisma: any, organizationId: string, orderIds: string[]): Promise<Array<{ id: string; config: Record<string, unknown> }>> {
  if (!orderIds.length) return [];
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, config->'orderId' AS "orderId", config->'cancelled' AS cancelled, config->'voided' AS voided, config->'erpImport' AS "erpImport"
       FROM "Document"
      WHERE "organizationId" = $1 AND type IN ('DELIVERY_ORDER', 'DO')
        AND jsonb_typeof(config->'orderId') = 'string' AND config->>'orderId' = ANY($2::text[])`,
    organizationId,
    orderIds,
  );
  return rows.map((r) => {
    const config: Record<string, unknown> = { orderId: r.orderId };
    for (const k of ['cancelled', 'voided', 'erpImport']) if (r[k] !== null && r[k] !== undefined) config[k] = r[k];
    return { id: r.id as string, config };
  });
}

/**
 * Repeating jobs: the series line on an occurrence and on a job made from one; an occurrence (not a job yet) has no
 * job page to open, and keeps its series' length.
 */
function withRepeat(e: CalendarEvent, repeatOf: Map<string, RepeatView>, durations: Map<string, number>): CalendarEvent {
  const runId = e.source === 'aims' && e.id.startsWith('aims:') ? e.id.slice(5) : null;
  const v = runId ? repeatOf.get(runId) : null;
  if (!v || !runId) return e;
  if (!isVirtualId(runId)) return { ...e, repeat: v } as any;
  const min = durations.get(runId);
  const end = !e.allDay && min ? new Date(new Date(e.start).getTime() + min * 60_000).toISOString() : e.end;
  return { ...e, end, repeat: v, occurrence: true, href: null, doHref: null, doNumber: null, doTag: null } as any;
}
