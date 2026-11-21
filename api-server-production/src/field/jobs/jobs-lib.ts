/**
 * Field jobs (FIELD_PLAN.md phase 2). Ported from siteclock backend @62b7d9d src/lib/jobs.ts (findPlace,
 * ensurePlaceSite, teamMembersOn, resolveCrew, visitFor, jobStatus, workerClocking / jobClockingOf,
 * newQrToken, fmtTime), src/lib/templateSites.ts and timesheets.service matchShift. Same rules; Prisma calls
 * read the Field tables (FieldSite / FieldTeamStint / FieldShiftAssignment) instead of SiteClock's.
 */
import { randomBytes } from 'crypto';
import { haversineM } from '../common/geo';
import { geocodeJobAddress } from '../common/geocode';
import { weekdayOf } from '../common/time';

type Db = any;
export type Place = { siteId?: string; name: string; address: string | null; lat: number; lng: number; kind: 'PERMANENT' | 'JOB' | 'BASE' };
type Geocoder = (q: string) => Promise<{ label: string; lat: number; lng: number } | null>;

let geocoder: Geocoder = geocodeJobAddress as Geocoder;
/** Tests swap in a deterministic geocoder (no network). */
export const setJobGeocoder = (g: Geocoder) => {
  geocoder = g;
};

/** A geocoded point this close to an existing job location reuses it. */
export const REUSE_M = 60;
/** Job locations are malls, shophouses, rooftops: a wider fence, looser GPS. */
export const JOB_RADIUS_M = 200;
export const JOB_MAX_ACCURACY_M = 100;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Where is `location`? An existing site by name, else the geocoded point (`search` is a better query when
 * given), snapped to an existing site whose fence (or a job place within REUSE_M) covers it. Never writes.
 */
export async function findPlace(db: Db, organizationId: string, location: string, search?: string | null): Promise<Place | null> {
  const sites = await db.fieldSite.findMany({ where: { organizationId, active: true }, select: { id: true, name: true, address: true, lat: true, lng: true, radiusM: true, kind: true } });
  const loc = norm(location);
  const byName = sites.find((s: any) => norm(s.name) === loc) ?? sites.find((s: any) => s.kind === 'PERMANENT' && loc.split(' ').length <= 3 && loc.includes(norm(s.name)));
  if (byName) return { siteId: byName.id, name: byName.name, address: byName.address, lat: byName.lat, lng: byName.lng, kind: byName.kind };
  const hit = await geocoder((search || location).trim());
  if (!hit) return null;
  const near = sites
    .map((s: any) => ({ s, d: haversineM(hit.lat, hit.lng, s.lat, s.lng) }))
    .filter(({ s, d }: any) => d <= (s.kind === 'JOB' ? REUSE_M : s.radiusM))
    .sort((a: any, b: any) => a.d - b.d)[0];
  if (near) return { siteId: near.s.id, name: near.s.name, address: near.s.address, lat: near.s.lat, lng: near.s.lng, kind: near.s.kind };
  return { name: location.trim().slice(0, 120), address: hit.label, lat: hit.lat, lng: hit.lng, kind: 'JOB' };
}

/** The site id for a place, creating the hidden JOB site on first use. */
export async function ensurePlaceSite(db: Db, organizationId: string, place: Place, timezone: string): Promise<string> {
  if (place.siteId) return place.siteId;
  const sites = await db.fieldSite.findMany({ where: { organizationId, kind: 'JOB', active: true }, select: { id: true, lat: true, lng: true } });
  const near = sites.find((s: any) => haversineM(place.lat, place.lng, s.lat, s.lng) <= REUSE_M);
  if (near) return near.id;
  const site = await db.fieldSite.create({
    data: { organizationId, kind: 'JOB', name: place.name, address: place.address, lat: place.lat, lng: place.lng, radiusM: JOB_RADIUS_M, maxAccuracyM: JOB_MAX_ACCURACY_M, timezone },
  });
  return site.id;
}

/** Who was in each team on `date` -> [{workerId, teamId}] (first team wins on overlap; active workers only). */
export async function teamMembersOn(db: Db, organizationId: string, teamIds: string[], date: string) {
  if (!teamIds.length) return [] as Array<{ workerId: string; teamId: string | null }>;
  const stints = await db.fieldTeamStint.findMany({
    where: { organizationId, teamId: { in: teamIds }, startDate: { lte: date }, OR: [{ endDate: null }, { endDate: { gte: date } }] },
    select: { workerId: true, teamId: true },
  });
  const active = new Set(
    (await db.worker.findMany({ where: { organizationId, active: true, id: { in: [...new Set(stints.map((s: any) => s.workerId))] } }, select: { id: true } })).map((w: any) => w.id),
  );
  const seen = new Set<string>();
  const out: Array<{ workerId: string; teamId: string | null }> = [];
  for (const t of teamIds) {
    for (const s of stints.filter((x: any) => x.teamId === t && active.has(x.workerId))) {
      if (!seen.has(s.workerId)) {
        seen.add(s.workerId);
        out.push({ workerId: s.workerId, teamId: t });
      }
    }
  }
  return out;
}

/** The crew: team members on that date (minus exceptions), then named workers not already in (naming overrides leaving out). */
export async function resolveCrew(db: Db, organizationId: string, date: string, teamIds: string[], workerIds: string[], exceptWorkerIds: string[] = []) {
  const except = new Set(exceptWorkerIds);
  const crew = (await teamMembersOn(db, organizationId, teamIds, date)).filter((c) => !except.has(c.workerId));
  const seen = new Set(crew.map((c) => c.workerId));
  for (const u of workerIds) if (!seen.has(u)) {
    seen.add(u);
    crew.push({ workerId: u, teamId: null });
  }
  return crew;
}

/** What a job's QR code encodes (rotated by the office -> old prints stop working). */
export const newQrToken = () => randomBytes(18).toString('base64url');

type JobPunchRow = { workerId: string; type: 'IN' | 'OUT'; serverTime: Date; status: string; insideFence: boolean; distanceM: number; autoLeft?: boolean };

/** One crew member's first arrival and last departure on a job (rejected punches never count). */
export function visitFor(punches: JobPunchRow[], workerId: string, now = new Date()) {
  const mine = punches.filter((p) => p.workerId === workerId && p.status !== 'REJECTED').sort((a, b) => +a.serverTime - +b.serverTime);
  const arrive = mine.find((p) => p.type === 'IN') ?? null;
  const leave = [...mine].reverse().find((p) => p.type === 'OUT' && (!arrive || p.serverTime >= arrive.serverTime)) ?? null;
  const mark = (p: JobPunchRow | null) => (p ? { at: p.serverTime, inside: p.autoLeft ? true : p.insideFence, distanceM: Math.round(p.distanceM), pending: p.status === 'FLAGGED', auto: !!p.autoLeft } : null);
  const a = mark(arrive);
  const l = mark(leave);
  return { arrived: a, left: l, onJobMinutes: a ? Math.max(0, Math.round(((l?.at ?? now).getTime() - a.at.getTime()) / 60_000)) : null };
}

/** IN_PROGRESS from the first crew clock-in, DONE once everyone who clocked in has clocked out. */
export function jobStatus(crew: Array<{ workerId: string }>, punches: JobPunchRow[]): 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' {
  const visits = crew.map((c) => visitFor(punches, c.workerId)).filter((v) => v.arrived);
  if (!visits.length) return 'NOT_STARTED';
  return visits.every((v) => v.left) ? 'DONE' : 'IN_PROGRESS';
}

export type Clocking = 'OFF' | 'ARRIVE' | 'ARRIVE_LEAVE';
export type WorkerClocking = { rule: Clocking; perWorker: boolean };

/** Job clocking for one worker on a date: their own setting wins; else the company rule (OFF outside its teams). */
export async function workerClocking(db: Db, organizationId: string, workerId: string, date: string): Promise<WorkerClocking> {
  const p = await db.fieldWorkerProfile.findUnique({ where: { workerId }, select: { jobClocking: true } });
  if (p?.jobClocking) return { rule: p.jobClocking, perWorker: true };
  const s = await db.fieldSettings.findUnique({ where: { organizationId }, select: { jobClocking: true, jobClockingTeamIds: true } });
  const rule: Clocking = s?.jobClocking ?? 'ARRIVE_LEAVE';
  if (rule === 'OFF') return { rule: 'OFF', perWorker: false };
  if (!s?.jobClockingTeamIds?.length) return { rule, perWorker: false };
  const members = await teamMembersOn(db, organizationId, s.jobClockingTeamIds, date);
  return { rule: members.some((m) => m.workerId === workerId) ? rule : 'OFF', perWorker: false };
}

/** What this worker does at this job: their own setting, else the job's, else the rule. */
export const jobClockingOf = (job: { clocking: Clocking | null }, w: WorkerClocking): Clocking => (w.perWorker ? w.rule : job.clocking ?? w.rule);

/** "9am", "8:30pm". */
export const fmtTime = (hhmm: string | null) => {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
};

// ── Working hours (templateSites.ts + matchShift) ───────────────────────────

/** A template applies to the sites in siteIds; empty = company-wide. */
export const templateCoversSite = (t: { siteIds: string[] }, siteId: string) => t.siteIds.length === 0 || t.siteIds.includes(siteId);
/** Site-specific templates before company-wide ones. */
export const siteSpecificFirst = (a: { template: { siteIds: string[] } }, b: { template: { siteIds: string[] } }) => (a.template.siteIds.length ? 0 : 1) - (b.template.siteIds.length ? 0 : 1);

/** The shift assignment covering workDate for this worker at this site (site-specific first), or null. */
export async function matchShift(db: Db, organizationId: string, workerId: string, siteId: string, workDate: string) {
  const weekday = weekdayOf(workDate);
  const asgs = await db.fieldShiftAssignment.findMany({
    where: { organizationId, workerId, startDate: { lte: workDate }, OR: [{ endDate: null }, { endDate: { gte: workDate } }] },
  });
  if (!asgs.length) return null;
  const templates = await db.fieldShiftTemplate.findMany({ where: { organizationId, id: { in: asgs.map((a: any) => a.templateId) }, active: true } });
  const out = asgs
    .map((a: any) => ({ ...a, template: templates.find((t: any) => t.id === a.templateId) }))
    .filter((a: any) => a.template && a.template.daysOfWeek.includes(weekday) && templateCoversSite(a.template, siteId));
  out.sort(siteSpecificFirst);
  return out[0] ?? null;
}
