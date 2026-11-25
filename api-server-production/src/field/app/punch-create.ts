/**
 * Clock in / out from the AIMS phone app. Ported line by line from siteclock backend @62b7d9d
 * src/modules/punches/punches.service.ts createPunch: same checks in the same order (job, QR, offline time,
 * job places, base, fence, selfie, device, drift, not assigned, out without in, already pending, mark only).
 * Differences: Field tables (worker = Worker id, org = organization id); no socket events, no pushes and no
 * face score (the selfie is kept for the reviewer); the address is stamped by the caller. The entry effect is
 * the engine's applyPunchEffect, unchanged.
 */
import { haversineM } from '../common/geo';
import { addDays, localDate } from '../common/time';
import { FieldEngine } from '../engine/engine';

type Db = any;

export interface PunchInput {
  siteId: string;
  type: 'IN' | 'OUT';
  lat: number;
  lng: number;
  accuracyM: number;
  deviceTime?: string;
  queuedAt?: string;
  mocked?: boolean;
  rooted?: boolean;
  deviceId?: string;
  idempotencyKey?: string;
  /** S3 key of the selfie (needed outside the fence, on a new phone, when the rules say always...). */
  photoKey?: string;
  overrideAutoClose?: boolean;
  workerNote?: string;
  nlb?: boolean;
  jobId?: string;
  endsDay?: boolean;
  /** Group clock-in / out: made for this worker by a crew member standing with them. */
  recordedByWorkerId?: string;
  qrToken?: string;
}

/** The person clocking: their Worker row, HR profile and the org's HR settings. */
export interface PunchActor {
  worker: { id: string; organizationId: string; name: string };
  profile: any;
  settings: any;
}

const DRIFT_LIMIT_MIN = 5;
const OFFLINE_FLAG_GAP_MIN = 60;
const OFFLINE_CLAMP_H = 48;
const PENDING_BLOCK_H = 6;

/** Job filter: everything except cancelled jobs. */
const liveJob = { NOT: { status: 'CANCELLED' } };
const aroundDates = (date: string) => [addDays(date, -1), date, addDays(date, 1)];

export class PunchBlockedError extends Error {
  constructor(public reason: string, public userMessage: string | null = null, public details: Record<string, unknown> = {}) {
    super(reason);
  }
}

/** A punch that needs a selfie arrived without one: the app retries with the photo. */
export class SelfieRequiredError extends Error {
  constructor(public readonly reason = 'OUTSIDE_FENCE') {
    super('SELFIE_REQUIRED');
  }
}

/** "You must be at Site B (within 150 m) to clock in. You are 2.1 km away." */
export function outsideFenceMessage(type: 'IN' | 'OUT', siteName: string, radiusM: number, distanceM: number) {
  const d = Math.round(distanceM);
  const away = d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${d} m`;
  return `You must be at ${siteName} (within ${radiusM} m) to clock ${type === 'IN' ? 'in' : 'out'}. You are ${away} away.`;
}

/** Flags about where the punch was made: Rules > Off-site clock-ins "mark only" lets these count at once. */
export const LOCATION_FLAGS: ReadonlySet<string> = new Set(['OUTSIDE_FENCE', 'POOR_ACCURACY', 'NOT_ASSIGNED', 'QR_MISSING']);

export async function orgsLinked(db: Db, a: string, b: string) {
  if (a === b) return true;
  return !!(await db.fieldOrgLink.findFirst({ where: { OR: [{ orgAId: a, orgBId: b }, { orgAId: b, orgBId: a }] } }));
}

/** Sites of the jobs this worker is on around these dates (their clock-in places for the day). */
export async function jobSiteIdsFor(db: Db, workerId: string, dates: string[]): Promise<Set<string>> {
  const mine = await db.fieldJobCrew.findMany({ where: { workerId }, select: { jobId: true } });
  if (!mine.length) return new Set();
  const jobs = await db.fieldJob.findMany({ where: { id: { in: mine.map((m: any) => m.jobId) }, date: { in: dates }, ...liveJob }, select: { siteId: true } });
  return new Set<string>(jobs.map((j: any) => j.siteId).filter(Boolean));
}

export type PunchResult =
  | { punch: any; duplicate: true }
  | { punch: any; flagged: true; site: any }
  | { punch: any; entry: any; marked?: true; site: any };

/**
 * Check and record a punch. A refused punch throws PunchBlockedError; one that needs a selfie throws
 * SelfieRequiredError; a flagged one is stored FLAGGED and has no timesheet effect until the office approves it.
 */
export async function createPunch(db: Db, actor: PunchActor, input: PunchInput, nowFn: () => Date = () => new Date()): Promise<PunchResult> {
  const { worker, profile, settings } = actor;
  const org = worker.organizationId;
  if (input.idempotencyKey) {
    const existing = await db.fieldPunch.findFirst({ where: { idempotencyKey: input.idempotencyKey, workerId: worker.id } });
    if (existing) return { punch: existing, duplicate: true };
  }

  let site = await db.fieldSite.findUnique({ where: { id: input.siteId } });
  if (!site || !site.active) throw new PunchBlockedError('SITE_NOT_FOUND');
  // A shared worker clocks at a linked org's job site with the one account they have.
  if (site.organizationId !== org && !(await orgsLinked(db, org, site.organizationId))) throw new PunchBlockedError('SITE_NOT_FOUND');
  const tz: string = settings.timezone || 'Asia/Singapore';

  // A job punch is pinned to that job's place; the worker must be on its crew and the job must be today's work.
  let job: { id: string; siteId: string; date: string; qrRequired: boolean; qrToken: string | null } | null = null;
  if (input.jobId) {
    const j = await db.fieldJob.findFirst({ where: { id: input.jobId, organizationId: site.organizationId, ...liveJob } });
    const onCrew = j ? await db.fieldJobCrew.findFirst({ where: { jobId: j.id, workerId: worker.id } }) : null;
    const jobSite = j?.siteId ? await db.fieldSite.findUnique({ where: { id: j.siteId } }) : null;
    if (!j || !onCrew || !jobSite || !jobSite.active) throw new PunchBlockedError('JOB_NOT_FOUND');
    if (!aroundDates(localDate(nowFn(), tz)).includes(j.date)) throw new PunchBlockedError('JOB_NOT_TODAY');
    job = { id: j.id, siteId: j.siteId, date: j.date, qrRequired: j.qrRequired, qrToken: j.qrToken };
    site = jobSite;
  }
  const endsDay = !!job && input.type === 'OUT' && input.endsDay === true;
  const onBehalf = !!input.recordedByWorkerId;

  // QR sign-in: a wrong or old code is refused; no scan at all needs a selfie and goes to review.
  const qrScanned = !!job?.qrRequired && !!input.qrToken && input.qrToken === job.qrToken;
  if (job?.qrRequired && input.qrToken && !qrScanned) throw new PunchBlockedError('QR_WRONG');
  const qrMissing = !!job?.qrRequired && !input.qrToken;
  if (qrMissing && !input.photoKey && !onBehalf) throw new SelfieRequiredError('QR_MISSING');

  const now = nowFn();
  // Offline punches take effect at queuedAt (kept inside a sane window).
  let effectiveTime = now;
  let offlineSynced = false;
  if (input.queuedAt) {
    const queued = new Date(input.queuedAt);
    if (!isNaN(queued.getTime()) && queued < now) {
      const floor = new Date(now.getTime() - OFFLINE_CLAMP_H * 3600_000);
      effectiveTime = queued < floor ? floor : queued;
      offlineSynced = true;
    }
  }

  // Today's job places count as the worker's sites; standing inside one while the app sent another site
  // makes the punch belong to that job site.
  const jobSiteIds = await jobSiteIdsFor(db, worker.id, aroundDates(localDate(effectiveTime, tz)));
  if (!job && jobSiteIds.size && haversineM(input.lat, input.lng, site.lat, site.lng) > site.radiusM) {
    const jobSites = await db.fieldSite.findMany({ where: { id: { in: [...jobSiteIds] }, active: true } });
    const inside = jobSites
      .map((s: any) => ({ s, d: haversineM(input.lat, input.lng, s.lat, s.lng) }))
      .filter(({ s, d }: any) => d <= s.radiusM)
      .sort((a: any, b: any) => a.d - b.d)[0];
    if (inside) site = inside.s;
  }
  if (site.organizationId !== org && !job && !jobSiteIds.has(site.id)) throw new PunchBlockedError('SITE_NOT_FOUND');

  const assignment = await db.fieldSiteAssignment.findFirst({ where: { workerId: worker.id, siteId: site.id } });
  // A base (office, yard, dorm): Rules > "Clock in and out at a base", or this worker's own setting.
  if (site.kind === 'BASE' && !job) {
    const baseAllowed = profile.baseClocking ? profile.baseClocking === 'ALLOWED' : settings.baseClocking;
    if (!baseAllowed) {
      throw new PunchBlockedError('BASE_NOT_ALLOWED', `${site.name} is a base. Clock ${input.type === 'IN' ? 'in' : 'out'} at the job or work site instead.`, { siteName: site.name });
    }
  }
  const assigned = !!assignment || !!job || jobSiteIds.has(site.id) || (site.kind === 'BASE' && site.allWorkers);

  const distanceM = haversineM(input.lat, input.lng, site.lat, site.lng);
  const insideFence = distanceM <= site.radiusM;
  const offSiteRule: string = profile.offSiteClocking ?? settings.offSiteReview;

  const selfieRule: string = profile.selfiePolicy ?? settings.selfiePolicy;
  if (selfieRule === 'ALWAYS' && !input.photoKey && !onBehalf) throw new SelfieRequiredError('POLICY');

  // ---- policy evaluation ----
  let flagReason: string | null = null;
  if (input.mocked) {
    if (settings.fraudPolicy === 'BLOCK') throw new PunchBlockedError('MOCKED_LOCATION');
    flagReason = 'MOCKED';
  } else if (input.rooted) {
    if (settings.fraudPolicy === 'BLOCK') throw new PunchBlockedError('ROOTED_DEVICE');
    flagReason = 'ROOTED';
  } else if (input.accuracyM > site.maxAccuracyM || !insideFence) {
    if (!insideFence && offSiteRule === 'BLOCK') {
      throw new PunchBlockedError('OUTSIDE_FENCE', outsideFenceMessage(input.type, site.name, site.radiusM, distanceM), { distanceM: Math.round(distanceM), radiusM: site.radiusM, siteName: site.name });
    }
    if (!input.photoKey && !onBehalf) throw new SelfieRequiredError();
    flagReason = insideFence ? 'POOR_ACCURACY' : 'OUTSIDE_FENCE';
  } else if (onBehalf) {
    // Made from a crew member's phone: device checks belong to their own punch.
  } else if (!profile.deviceVerified || profile.verifyRequested) {
    if (!input.photoKey) throw new SelfieRequiredError(profile.verifyRequested ? 'VERIFY_REQUESTED' : 'NEW_DEVICE');
    flagReason = profile.verifyRequested ? 'VERIFY_REQUESTED' : 'NEW_DEVICE';
  } else if (input.deviceId && profile.deviceId && input.deviceId !== profile.deviceId) {
    flagReason = 'NEW_DEVICE';
  } else if (!offlineSynced && input.deviceTime) {
    const dt = new Date(input.deviceTime);
    if (!isNaN(dt.getTime()) && Math.abs(dt.getTime() - now.getTime()) > DRIFT_LIMIT_MIN * 60_000) flagReason = 'TIME_DRIFT';
  }
  if (!flagReason && offlineSynced && now.getTime() - effectiveTime.getTime() > OFFLINE_FLAG_GAP_MIN * 60_000) flagReason = 'OFFLINE';
  if (!flagReason && qrMissing) flagReason = 'QR_MISSING';
  if (!flagReason && !assigned) {
    flagReason = 'NOT_ASSIGNED';
    if (settings.unassignedSelfie && !input.photoKey && !onBehalf) throw new SelfieRequiredError('NOT_ASSIGNED');
  }

  const engine = new FieldEngine(db, nowFn);
  // OUT with no open entry at this site is flagged; a job clock-out is not the day's clock-out unless it ends the day.
  let openEntry: any = null;
  if (input.type === 'OUT' && (!job || endsDay)) {
    openEntry = await engine.findOpenEntryForOut(worker.id, site.id);
    if (!openEntry && input.overrideAutoClose) {
      const reclosable = await engine.findReclosableEntry(worker.id, site.id, effectiveTime);
      if (!reclosable) throw new PunchBlockedError('NO_AUTO_CLOSED_ENTRY');
      if (!input.photoKey) throw new SelfieRequiredError('AUTO_CLOSE_OVERRIDE');
      flagReason = 'AUTO_CLOSE_OVERRIDE';
    } else if (!openEntry && !flagReason) {
      flagReason = 'OUT_WITHOUT_IN';
    }
  }

  // A same-type punch already waiting for review must be decided first.
  const pendingSince = input.type === 'OUT' && openEntry ? openEntry.clockInAt : new Date(now.getTime() - PENDING_BLOCK_H * 3600_000);
  const pendingSame = await db.fieldPunch.findFirst({
    where: { workerId: worker.id, ...(job ? { jobId: job.id } : { siteId: site.id }), type: input.type, status: 'FLAGGED', serverTime: { gte: pendingSince } },
  });
  if (pendingSame) throw new PunchBlockedError('ALREADY_PENDING');

  const marked = !!flagReason && LOCATION_FLAGS.has(flagReason) && offSiteRule === 'MARK';

  const punch = await db.fieldPunch.create({
    data: {
      organizationId: org,
      workerId: worker.id,
      siteId: site.id,
      type: input.type,
      serverTime: effectiveTime,
      deviceTime: input.deviceTime ? new Date(input.deviceTime) : null,
      lat: input.lat,
      lng: input.lng,
      accuracyM: input.accuracyM,
      distanceM: Math.round(distanceM),
      insideFence,
      mockedFlag: !!input.mocked,
      rootedFlag: !!input.rooted,
      offlineSynced,
      deviceId: input.deviceId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      photoKey: input.photoKey ?? null,
      workerNote: input.workerNote?.trim() || null,
      nlbClaimed: input.nlb === true,
      status: flagReason && !marked ? 'FLAGGED' : 'OK',
      flagReason,
      jobId: job?.id ?? null,
      endsDay,
      recordedByWorkerId: input.recordedByWorkerId ?? null,
      qrScanned,
    },
  });

  if (flagReason && !marked) return { punch, flagged: true, site };
  const entry = await engine.applyPunchEffect(punch, site);
  return { punch, entry, site, ...(marked ? { marked: true as const } : {}) };
}
