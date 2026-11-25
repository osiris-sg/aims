/**
 * The worker side of HR: what the AIMS phone app calls (/field/app/*). Ported from siteclock backend @62b7d9d
 * (auth.router /me, punches.router, timesheets.router /mine + /missed-request, leave.router worker routes,
 * terms.router, photos.router /mine, payroll.router /me, schedules.router /mine, jobs.router /mine), with the
 * same response shapes so the app's screens read them unchanged: a "user" is the Worker, a "company" is the
 * organization. Reads work whenever the HR module is on; clocking in and out also needs fieldEngineLive.
 * Files (selfies, photo on record, leave documents) go to S3 under field/<org>/...; nothing is sent to phones
 * (no pushes yet) and there is no face score.
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { S3Service } from '../../common/services/s3.service';
import { reverseGeocode } from '../common/geocode';
import { addDays, localDate, localTimeToUtc, todayIn } from '../common/time';
import { FieldEngine } from '../engine/engine';
import { jobClockingOf, jobStatus, matchShift, visitFor, workerClocking, type WorkerClocking } from '../jobs/jobs-lib';
import { leaveDaysInYear } from '../leave/leave.service';
import { computeMonthlyPayroll } from '../payroll/payroll-engine';
import { AppCtx, appError } from './app-context';
import { DEFAULT_TERMS } from './default-terms';
import { PunchBlockedError, SelfieRequiredError, createPunch, jobSiteIdsFor, type PunchInput } from './punch-create';

export type Upload = { buffer: Buffer; mimetype: string; originalname?: string; size: number };

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const liveJob = { NOT: { status: 'CANCELLED' } };
const aroundDates = (date: string) => [addDays(date, -1), date, addDays(date, 1)];
const OPEN_PHOTO = ['REQUESTED', 'PENDING'];
export const MAX_LEAVE_DOCUMENTS = 5;

// Multipart fields arrive as strings.
const boolish = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().optional());
const punchSchema = z.object({
  siteId: z.string().min(1),
  type: z.enum(['IN', 'OUT']),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  accuracyM: z.coerce.number().min(0),
  deviceTime: z.string().datetime().optional(),
  queuedAt: z.string().datetime().optional(),
  mocked: boolish,
  rooted: boolish,
  deviceId: z.string().optional(),
  idempotencyKey: z.string().max(100).optional(),
  overrideAutoClose: boolish,
  workerNote: z.string().max(300).optional(),
  nlb: boolish,
  jobId: z.string().max(60).optional(),
  endsDay: boolish,
  qrToken: z.string().max(120).optional(),
});
const groupSchema = punchSchema.extend({
  jobId: z.string().max(60),
  userIds: z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    try {
      return JSON.parse(v);
    } catch {
      return v.split(',').filter(Boolean);
    }
  }, z.array(z.string()).max(100)),
});

/** A site as the app reads it (SiteClock's Site: companyId instead of organizationId). */
const siteOut = (s: any) => (s ? { id: s.id, companyId: s.organizationId, name: s.name, address: s.address, lat: s.lat, lng: s.lng, radiusM: s.radiusM, timezone: s.timezone, maxAccuracyM: s.maxAccuracyM, autoCloseAfterH: s.autoCloseAfterH, active: s.active, kind: s.kind, allWorkers: s.allWorkers } : null);

/** A punch as the app reads it: no storage key, no device id. */
const punchOut = ({ photoKey, deviceId, idempotencyKey, organizationId, workerId, recordedByWorkerId, ...p }: any) => ({
  ...p,
  companyId: organizationId,
  userId: workerId,
  recordedById: recordedByWorkerId ?? null,
  photoPath: photoKey ? `punches/${p.id}` : null,
});

const entryOut = ({ organizationId, workerId, ...e }: any) => ({ ...e, companyId: organizationId, userId: workerId });

const extOf = (mime: string) => (mime === 'image/png' ? 'png' : mime === 'application/pdf' ? 'pdf' : 'jpg');
const mimeOfKey = (key: string) => (key.endsWith('.png') ? 'image/png' : key.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

@Injectable()
export class FieldAppService {
  constructor(private readonly prisma: PrismaService, private readonly s3: S3Service) {}
  private get db(): any {
    return this.prisma as any;
  }

  // ── Files ─────────────────────────────────────────────────────────────────

  private async store(ctx: AppCtx, kind: 'punches' | 'binds' | 'leave', file: Upload): Promise<string> {
    const key = `field/${ctx.organizationId}/${kind}/${Date.now()}-${randomUUID()}.${extOf(file.mimetype)}`;
    await this.s3.uploadFile(key, file.buffer, file.mimetype === 'application/pdf' ? 'application/pdf' : file.mimetype === 'image/png' ? 'image/png' : 'image/jpeg');
    return key;
  }

  private discard(key?: string | null) {
    if (key) void this.s3.deleteFile(key).catch(() => {});
  }

  /** A stored file's bytes. Files still in SiteClock ("siteclock:" keys) are not here yet. */
  private async bytes(key: string | null | undefined) {
    if (!key || String(key).startsWith('siteclock:')) throw appError(404, 'Not found');
    try {
      return { buffer: await this.s3.downloadFile(key), contentType: mimeOfKey(key) };
    } catch {
      throw appError(404, 'Photo missing');
    }
  }

  // ── Me ────────────────────────────────────────────────────────────────────

  private async photoStatus(ctx: AppCtx) {
    const [open, last] = await Promise.all([
      this.db.fieldPhotoUpdate.findFirst({ where: { workerId: ctx.worker.id, status: { in: OPEN_PHOTO } }, orderBy: { createdAt: 'desc' } }),
      this.db.fieldPhotoUpdate.findFirst({ where: { workerId: ctx.worker.id, status: 'REJECTED' }, orderBy: { reviewedAt: 'desc' } }),
    ]);
    const recent = last?.reviewedAt && Date.now() - last.reviewedAt.getTime() < 7 * 86_400_000;
    return {
      hasPhoto: !!ctx.profile.photoKey,
      status: (open?.status ?? null) as 'REQUESTED' | 'PENDING' | null,
      requested: !!open?.requestedById || !!open?.auto,
      auto: !!open?.auto,
      note: open?.note ?? null,
      rejected: !open && recent ? { note: last.note } : null,
    };
  }

  /** Rules > "Ask for a photo at first login": someone who clocks and has no photo on record must take one first. */
  private async requestPhotoAtFirstLogin(ctx: AppCtx) {
    const p = ctx.profile;
    if (p.photoKey || p.attendanceExempt || !ctx.settings.photoAtFirstLogin) return;
    if (p.tier !== 'WORKER' && p.tier !== 'SUPERVISOR') return;
    if (await this.db.fieldPhotoUpdate.findFirst({ where: { workerId: ctx.worker.id, status: { in: OPEN_PHOTO } } })) return;
    await this.db.fieldPhotoUpdate.create({
      data: { organizationId: ctx.organizationId, workerId: ctx.worker.id, status: 'REQUESTED', auto: true, setVerify: false, note: 'Welcome to AIMS. Your company needs a photo of you on record. Take it now, before your first clock in.' },
    });
  }

  private async userOut(ctx: AppCtx) {
    const { worker, profile: p, settings: s } = ctx;
    await this.requestPhotoAtFirstLogin(ctx);
    const today = todayIn(s.timezone || 'Asia/Singapore');
    const jobSiteIds = await jobSiteIdsFor(this.db, worker.id, aroundDates(today));
    const baseAllowed = p.baseClocking ? p.baseClocking === 'ALLOWED' : !!s.baseClocking;
    const [assignments, companySites] = await Promise.all([
      this.db.fieldSiteAssignment.findMany({ where: { workerId: worker.id } }),
      this.db.fieldSite.findMany({
        where: { active: true, OR: [{ organizationId: ctx.organizationId, kind: baseAllowed ? { in: ['PERMANENT', 'BASE'] } : 'PERMANENT' }, { id: { in: [...jobSiteIds] } }] },
        orderBy: { name: 'asc' },
      }),
    ]);
    const asgSites = assignments.length ? await this.db.fieldSite.findMany({ where: { id: { in: assignments.map((a: any) => a.siteId) } } }) : [];
    const byId = new Map<string, any>(asgSites.map((x: any) => [x.id, x]));
    const supervises = assignments.some((a: any) => a.isSupervisor) || !!(await this.db.fieldTeamSupervisor.findFirst({ where: { organizationId: ctx.organizationId, workerId: worker.id } }));
    const { termsText, ...rules } = s;
    return {
      id: worker.id,
      name: worker.name,
      phone: worker.phone,
      active: worker.active,
      role: p.tier,
      employeeNo: p.employeeNo,
      companyId: ctx.organizationId,
      company: { ...rules, id: ctx.organizationId, name: ctx.organizationName, active: true, clockingLive: ctx.live },
      deviceId: p.deviceId,
      deviceBoundAt: p.deviceBoundAt,
      deviceVerified: p.deviceVerified,
      verifyRequested: p.verifyRequested,
      lastBindPhotoPath: p.photoKey ? 'binds/current' : null,
      termsAcceptedVersion: p.termsAcceptedVersion,
      termsAcceptedAt: p.termsAcceptedAt,
      attendanceExempt: p.attendanceExempt,
      payslipVisible: p.payslipVisible,
      jobClocking: p.jobClocking,
      offSiteClocking: p.offSiteClocking,
      selfiePolicy: p.selfiePolicy,
      baseClocking: p.baseClocking,
      siteAssignments: assignments.filter((a: any) => byId.get(a.siteId)?.active).map((a: any) => ({ id: a.id, userId: worker.id, siteId: a.siteId, isSupervisor: a.isSupervisor, site: siteOut(byId.get(a.siteId)) })),
      companySites: companySites.map(siteOut),
      photo: await this.photoStatus(ctx),
      // Office work is done in the AIMS portal: the app holds no office permissions.
      permissions: [] as string[],
      scope: 'ASSIGNED',
      supervises,
      companyRole: { id: null, name: p.tier === 'WORKER' ? 'Worker' : p.tier === 'SUPERVISOR' ? 'Supervisor' : 'Admin' },
    };
  }

  async me(ctx: AppCtx) {
    return { user: await this.userOut(ctx) };
  }

  /** Tie this phone to the person. A first phone binds quietly; a different one means the next clock-in needs a selfie and a review. */
  async device(ctx: AppCtx, body: unknown) {
    const b = z.object({ deviceId: z.string().min(1).max(200) }).safeParse(body);
    if (!b.success) throw appError(400, 'Invalid request');
    const p = ctx.profile;
    let rebind = false;
    if (p.deviceId !== b.data.deviceId) {
      rebind = !!p.deviceId;
      ctx.profile = await this.db.fieldWorkerProfile.update({ where: { workerId: ctx.worker.id }, data: { deviceId: b.data.deviceId, deviceBoundAt: new Date(), ...(rebind ? { deviceVerified: false } : {}) } });
    }
    return { user: await this.userOut(ctx), rebind, audit: p.deviceId !== b.data.deviceId ? { action: rebind ? 'DEVICE_REBIND' : 'DEVICE_BIND', before: { deviceId: p.deviceId }, after: { deviceId: b.data.deviceId } } : null };
  }

  async fcmToken(ctx: AppCtx, body: unknown) {
    const b = z.object({ token: z.string().min(10).max(512) }).safeParse(body);
    if (!b.success) throw appError(400, 'Invalid token');
    await this.db.fieldWorkerProfile.updateMany({ where: { fcmToken: b.data.token, NOT: { workerId: ctx.worker.id } }, data: { fcmToken: null } });
    await this.db.fieldWorkerProfile.update({ where: { workerId: ctx.worker.id }, data: { fcmToken: b.data.token } });
    return { ok: true };
  }

  /** "Delete my account" in the app: this phone is unlinked. HR records are the employer's and stay; the office removes the worker. */
  async forgetDevice(ctx: AppCtx) {
    await this.db.fieldWorkerProfile.update({ where: { workerId: ctx.worker.id }, data: { deviceId: null, deviceBoundAt: null, fcmToken: null } });
    return { ok: true };
  }

  // ── Terms ─────────────────────────────────────────────────────────────────

  async terms(ctx: AppCtx) {
    const s = ctx.settings;
    const p = ctx.profile;
    return { text: s.termsText ?? DEFAULT_TERMS, version: s.termsVersion, updatedAt: s.termsUpdatedAt, acceptedVersion: p.termsAcceptedVersion, acceptedAt: p.termsAcceptedAt, mustAccept: (p.termsAcceptedVersion ?? 0) < s.termsVersion };
  }

  async acceptTerms(ctx: AppCtx, body: unknown) {
    const b = z.object({ version: z.coerce.number().int().min(1) }).safeParse(body);
    if (!b.success) throw appError(400, 'Invalid request');
    if (b.data.version !== ctx.settings.termsVersion) throw appError(409, 'Terms have changed. Please reload and read the latest version');
    const acceptedAt = new Date();
    await this.db.fieldWorkerProfile.update({ where: { workerId: ctx.worker.id }, data: { termsAcceptedVersion: ctx.settings.termsVersion, termsAcceptedAt: acceptedAt } });
    return { ok: true, version: ctx.settings.termsVersion, acceptedAt };
  }

  // ── Clock in / out ────────────────────────────────────────────────────────

  private requireLive(ctx: AppCtx) {
    if (!ctx.live) throw appError(422, 'Clocking in with AIMS is not switched on for your company yet. Ask your office.', { code: 'CLOCKING_NOT_LIVE', blocked: true });
  }

  private punchError(e: unknown) {
    if (e instanceof SelfieRequiredError) return appError(400, 'SELFIE_REQUIRED', { selfieRequired: true, reason: e.reason });
    if (e instanceof PunchBlockedError) return appError(422, e.userMessage ?? e.reason, { code: e.reason, blocked: true, ...e.details });
    return null;
  }

  private stampAddress(punchId: string, lat: number, lng: number) {
    reverseGeocode(lat, lng)
      .then((address) => (address ? this.db.fieldPunch.update({ where: { id: punchId }, data: { address } }) : null))
      .catch(() => {});
  }

  private async photoStepOpen(ctx: AppCtx) {
    return (await this.db.fieldPhotoUpdate.findFirst({ where: { workerId: ctx.worker.id, status: { in: OPEN_PHOTO } }, orderBy: { createdAt: 'desc' } }))?.status === 'REQUESTED';
  }

  async punch(ctx: AppCtx, body: unknown, file?: Upload) {
    this.requireLive(ctx);
    const parse = punchSchema.safeParse(body);
    if (!parse.success) throw appError(400, 'Check the clock-in details', { fields: parse.error.flatten() });
    // The office asked for a new photo on record: it comes first (a punch queued offline still syncs).
    if (!parse.data.queuedAt && (await this.photoStepOpen(ctx))) throw appError(409, 'PHOTO_REQUIRED', { photoRequired: true });
    const photoKey = file ? await this.store(ctx, 'punches', file) : undefined;
    try {
      const r = await createPunch(this.db, ctx, { ...(parse.data as PunchInput), photoKey });
      if ('duplicate' in r) {
        this.discard(photoKey);
        return { status: 200, body: { punch: punchOut(r.punch), duplicate: true } };
      }
      this.stampAddress(r.punch.id, parse.data.lat, parse.data.lng);
      if ('flagged' in r) return { status: 201, body: { punch: punchOut(r.punch), flagged: true } };
      return { status: 201, body: { punch: punchOut(r.punch), entry: r.entry ? entryOut(r.entry) : null, ...(r.marked ? { marked: true } : {}) } };
    } catch (e) {
      this.discard(photoKey);
      throw this.punchError(e) ?? e;
    }
  }

  private async isLeader(ctx: AppCtx) {
    if (ctx.profile.tier !== 'WORKER') return true;
    const [team, site] = await Promise.all([
      this.db.fieldTeamSupervisor.findFirst({ where: { organizationId: ctx.organizationId, workerId: ctx.worker.id } }),
      this.db.fieldSiteAssignment.findFirst({ where: { workerId: ctx.worker.id, isSupervisor: true } }),
    ]);
    return !!team || !!site;
  }

  /** Group clock-in / out at a job: my own punch as usual, then the same punch for each crew member ticked, recorded as made by me. */
  async punchGroup(ctx: AppCtx, body: unknown, file?: Upload) {
    this.requireLive(ctx);
    const parse = groupSchema.safeParse(body);
    if (!parse.success) throw appError(400, 'Check the clock-in details', { fields: parse.error.flatten() });
    if (!ctx.settings.groupJobClocking) throw appError(403, 'GROUP_CLOCKING_OFF');
    if (ctx.settings.groupClockBy === 'SUPERVISORS' && !(await this.isLeader(ctx))) throw appError(403, 'GROUP_CLOCKING_LEADER_ONLY');
    const job = await this.db.fieldJob.findFirst({ where: { id: parse.data.jobId, organizationId: ctx.organizationId, ...liveJob } });
    const crew = job ? await this.db.fieldJobCrew.findMany({ where: { jobId: job.id } }) : [];
    if (!job || !crew.some((c: any) => c.workerId === ctx.worker.id)) throw appError(422, 'JOB_NOT_FOUND', { blocked: true });
    if (!parse.data.queuedAt && (await this.photoStepOpen(ctx))) throw appError(409, 'PHOTO_REQUIRED', { photoRequired: true });
    const { userIds, ...input } = parse.data;
    const photoKey = file ? await this.store(ctx, 'punches', file) : undefined;
    let mine;
    try {
      mine = await createPunch(this.db, ctx, { ...(input as PunchInput), photoKey });
    } catch (e) {
      this.discard(photoKey);
      throw this.punchError(e) ?? e;
    }
    if (!('duplicate' in mine)) this.stampAddress(mine.punch.id, input.lat, input.lng);
    const ids = crew.map((c: any) => c.workerId).filter((id: string) => id !== ctx.worker.id && userIds.includes(id));
    const workers = ids.length ? await this.db.worker.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, organizationId: true, name: true } }) : [];
    const others: { userId: string; name: string; ok: boolean; flagged: boolean; error?: string }[] = [];
    for (const w of workers) {
      try {
        const profile = (await this.db.fieldWorkerProfile.findUnique({ where: { workerId: w.id } })) ?? (await this.db.fieldWorkerProfile.create({ data: { organizationId: w.organizationId, workerId: w.id } }));
        const settings = w.organizationId === ctx.organizationId ? ctx.settings : (await this.db.fieldSettings.findUnique({ where: { organizationId: w.organizationId } })) ?? ctx.settings;
        const r = await createPunch(this.db, { worker: w, profile, settings }, {
          ...(input as PunchInput),
          photoKey: undefined,
          deviceId: undefined,
          deviceTime: undefined,
          idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:${w.id}` : undefined,
          recordedByWorkerId: ctx.worker.id,
        });
        others.push({ userId: w.id, name: w.name, ok: true, flagged: 'flagged' in r });
      } catch (e) {
        const known = e instanceof PunchBlockedError ? e.userMessage ?? e.reason : e instanceof SelfieRequiredError ? 'SELFIE_REQUIRED' : null;
        others.push({ userId: w.id, name: w.name, ok: false, flagged: false, error: known ?? 'Something went wrong' });
      }
    }
    const audit = { jobId: job.id, type: input.type, endsDay: !!input.endsDay, others };
    if ('duplicate' in mine) return { status: 200, body: { punch: punchOut(mine.punch), duplicate: true, others }, audit };
    if ('flagged' in mine) return { status: 201, body: { punch: punchOut(mine.punch), flagged: true, others }, audit };
    return { status: 201, body: { punch: punchOut(mine.punch), entry: mine.entry ? entryOut(mine.entry) : null, others, ...(mine.marked ? { marked: true } : {}) }, audit };
  }

  async punchesMine(ctx: AppCtx) {
    const punches = await this.db.fieldPunch.findMany({ where: { workerId: ctx.worker.id }, orderBy: { serverTime: 'desc' }, take: 100 });
    const sites = await this.db.fieldSite.findMany({ where: { id: { in: [...new Set(punches.map((p: any) => p.siteId))] } }, select: { id: true, name: true, timezone: true } });
    const s = new Map(sites.map((x: any) => [x.id, x]));
    return { punches: punches.map((p: any) => ({ ...punchOut(p), site: s.get(p.siteId) ?? null })) };
  }

  /** My own selfie on a punch. */
  async punchPhoto(ctx: AppCtx, id: string) {
    const p = await this.db.fieldPunch.findFirst({ where: { id, workerId: ctx.worker.id } });
    if (!p) throw appError(404, 'Not found');
    return this.bytes(p.photoKey);
  }

  // ── My hours ──────────────────────────────────────────────────────────────

  async timesheetsMine(ctx: AppCtx) {
    const entries = await this.db.fieldTimeEntry.findMany({ where: { workerId: ctx.worker.id }, orderBy: { clockInAt: 'desc' }, take: 60 });
    const [sites, punches] = await Promise.all([
      this.db.fieldSite.findMany({ where: { id: { in: [...new Set(entries.map((e: any) => e.siteId))] } }, select: { id: true, name: true, timezone: true } }),
      entries.length ? this.db.fieldPunch.findMany({ where: { timeEntryId: { in: entries.map((e: any) => e.id) } }, orderBy: { serverTime: 'asc' } }) : [],
    ]);
    const s = new Map(sites.map((x: any) => [x.id, x]));
    const pick = (p: any) => ({ id: p.id, type: p.type, serverTime: p.serverTime, originalTime: p.originalTime, status: p.status, flagReason: p.flagReason, photoPath: p.photoKey ? `punches/${p.id}` : null, lat: p.lat, lng: p.lng, insideFence: p.insideFence, faceScore: p.faceScore, faceResult: p.faceResult, address: p.address, distanceM: p.distanceM });
    return { entries: entries.map((e: any) => ({ ...entryOut(e), site: s.get(e.siteId) ?? null, punches: punches.filter((p: any) => p.timeEntryId === e.id).map(pick) })) };
  }

  /** "I forgot to clock": a PENDING entry for the office to review. */
  async missedRequest(ctx: AppCtx, body: unknown) {
    this.requireLive(ctx);
    const parse = z.object({ siteId: z.string(), clockInAt: z.string().datetime(), clockOutAt: z.string().datetime(), note: z.string().min(3).max(500) }).safeParse(body);
    if (!parse.success) throw appError(400, 'Check the times and add a short note', { fields: parse.error.flatten() });
    const site = await this.db.fieldSite.findFirst({ where: { id: parse.data.siteId, organizationId: ctx.organizationId, active: true } });
    if (!site) throw appError(404, 'Site not found');
    const clockInAt = new Date(parse.data.clockInAt);
    const clockOutAt = new Date(parse.data.clockOutAt);
    const now = new Date();
    if (clockOutAt <= clockInAt) throw appError(400, 'clockOutAt must be after clockInAt');
    if (clockOutAt > now) throw appError(400, 'Times must be in the past');
    if (clockInAt < new Date(now.getTime() - 14 * 24 * 3600_000)) throw appError(400, 'Requests limited to the last 14 days');
    const overlap = await this.db.fieldTimeEntry.findFirst({
      where: { workerId: ctx.worker.id, status: { not: 'REJECTED' }, clockInAt: { lt: clockOutAt }, OR: [{ clockOutAt: null }, { clockOutAt: { gt: clockInAt } }] },
    });
    if (overlap) throw appError(409, 'An entry already exists for this period');
    const engine = new FieldEngine(this.db);
    const entry = await this.db.$transaction(async (tx: any) => {
      const e = await tx.fieldTimeEntry.create({
        data: {
          organizationId: ctx.organizationId, workerId: ctx.worker.id, siteId: site.id, workDate: localDate(clockInAt, site.timezone), clockInAt, clockOutAt, status: 'PENDING',
          editedById: `worker:${ctx.worker.id}`, editedByName: ctx.worker.name, editedAt: now, editNote: `worker request: ${parse.data.note}`,
        },
      });
      return engine.computeEntry(tx, e.id, 'PENDING');
    });
    return { entry: entryOut(entry) };
  }

  /** My shift today at a site (the clock screen shows it). */
  async scheduleMine(ctx: AppCtx, siteId?: string) {
    const site = siteId ? await this.db.fieldSite.findUnique({ where: { id: siteId } }) : null;
    if (!site) throw appError(404, 'Not found');
    const date = todayIn(site.timezone);
    const shift = await matchShift(this.db, ctx.organizationId, ctx.worker.id, site.id, date);
    if (!shift) return { shift: null };
    const t = shift.template;
    return { shift: { name: t.name, startTime: t.startTime, endTime: t.endTime, graceLateMin: t.graceLateMin, startAt: localTimeToUtc(date, t.startTime, site.timezone) } };
  }

  // ── Leave ─────────────────────────────────────────────────────────────────

  private leaveOut = ({ documentKeys = [], organizationId, workerId, ...r }: any) => ({
    ...r,
    companyId: organizationId,
    userId: workerId,
    hasDocument: documentKeys.length > 0,
    documentCount: documentKeys.length,
    documentUrl: documentKeys.length ? `/leave/requests/${r.id}/documents/0` : null,
    documents: documentKeys.map((_: string, i: number) => ({ index: i, url: `/leave/requests/${r.id}/documents/${i}` })),
    recorded: !!r.recordedById,
  });

  private typeOut = ({ organizationId, siteclockId, ...t }: any) => ({ ...t, companyId: organizationId });

  async leaveTypes(ctx: AppCtx) {
    const types = await this.db.fieldLeaveType.findMany({ where: { organizationId: ctx.organizationId, archived: false }, orderBy: { name: 'asc' } });
    return { types: types.map(this.typeOut) };
  }

  async leaveBalances(ctx: AppCtx, yearQ?: string) {
    const y = Number(yearQ);
    const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : new Date().getFullYear();
    const [types, ents, requests] = await Promise.all([
      this.db.fieldLeaveType.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { name: 'asc' } }),
      this.db.fieldLeaveEntitlement.findMany({ where: { workerId: ctx.worker.id } }),
      this.db.fieldLeaveRequest.findMany({ where: { workerId: ctx.worker.id, status: { in: ['APPROVED', 'PENDING'] }, startDate: { lte: `${year}-12-31` }, endDate: { gte: `${year}-01-01` } } }),
    ]);
    const balances = types
      .map((t: any) => {
        const own = ents.find((e: any) => e.typeId === t.id);
        const entitled = own?.days ?? t.defaultDays;
        const sum = (status: string) => requests.filter((r: any) => r.typeId === t.id && r.status === status).reduce((n: number, r: any) => n + leaveDaysInYear(r, year), 0);
        const taken = sum('APPROVED');
        return { typeId: t.id, name: t.name, paid: t.paid, defaultDays: t.defaultDays, entitled: entitled ?? null, custom: !!own, taken, pending: sum('PENDING'), remaining: entitled == null ? null : entitled - taken, archived: t.archived };
      })
      .filter((b: any) => !b.archived || b.taken > 0);
    return { year, balances };
  }

  private async withType(rows: any[]) {
    const types = rows.length ? await this.db.fieldLeaveType.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.typeId))] } } }) : [];
    const t = new Map(types.map((x: any) => [x.id, this.typeOut(x)]));
    return rows.map((r) => ({ ...this.leaveOut(r), type: t.get(r.typeId) ?? null }));
  }

  async leaveMine(ctx: AppCtx) {
    const requests = await this.db.fieldLeaveRequest.findMany({ where: { workerId: ctx.worker.id }, orderBy: { createdAt: 'desc' } });
    return { requests: await this.withType(requests) };
  }

  async leaveRequest(ctx: AppCtx, body: unknown, files: Upload[] = []) {
    const parse = z
      .object({
        typeId: z.string(),
        startDate: z.string().regex(dateRe),
        endDate: z.string().regex(dateRe),
        halfDay: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().default(false)),
        reason: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(500).optional()),
      })
      .safeParse(body);
    if (!parse.success) throw appError(400, 'Check the leave dates', { fields: parse.error.flatten() });
    if (parse.data.endDate < parse.data.startDate) throw appError(400, 'endDate before startDate');
    const type = await this.db.fieldLeaveType.findFirst({ where: { id: parse.data.typeId, organizationId: ctx.organizationId, archived: false } });
    if (!type) throw appError(404, 'Leave type not found');
    if (type.requiresDocument && files.length === 0) {
      throw appError(400, 'DOCUMENT_REQUIRED', { message: `${type.name} needs a photo of the medical certificate (or supporting document) attached.` });
    }
    const documentKeys: string[] = [];
    for (const f of files.slice(0, MAX_LEAVE_DOCUMENTS)) documentKeys.push(await this.store(ctx, 'leave', f));
    const request = await this.db.fieldLeaveRequest.create({ data: { ...parse.data, reason: parse.data.reason ?? null, organizationId: ctx.organizationId, workerId: ctx.worker.id, documentKeys } });
    return { request: (await this.withType([request]))[0] };
  }

  async leaveCancel(ctx: AppCtx, id: string) {
    const request = await this.db.fieldLeaveRequest.findFirst({ where: { id, workerId: ctx.worker.id } });
    if (!request) throw appError(404, 'Not found');
    if (!['PENDING', 'APPROVED'].includes(request.status)) throw appError(409, 'Cannot cancel');
    if (request.recordedById) throw appError(409, 'RECORDED_BY_OFFICE', { message: 'This leave was entered by the office. Ask your admin to change it.' });
    const updated = await this.db.fieldLeaveRequest.update({ where: { id: request.id }, data: { status: 'CANCELLED' } });
    return { request: (await this.withType([updated]))[0], before: { status: request.status } };
  }

  async leaveDocument(ctx: AppCtx, id: string, index: number) {
    const request = await this.db.fieldLeaveRequest.findFirst({ where: { id, workerId: ctx.worker.id } });
    if (!request || !Number.isInteger(index) || index < 0) throw appError(404, 'Not found');
    return this.bytes(request.documentKeys[index]);
  }

  // ── Photo on record ───────────────────────────────────────────────────────

  async photoMine(ctx: AppCtx) {
    return this.photoStatus(ctx);
  }

  async photoCurrent(ctx: AppCtx) {
    return this.bytes(ctx.profile.photoKey);
  }

  async photoPending(ctx: AppCtx) {
    const open = await this.db.fieldPhotoUpdate.findFirst({ where: { workerId: ctx.worker.id, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    return this.bytes(open?.photoKey);
  }

  /** Send a new photo: answers the office's request, or starts my own update. Either way the office approves it. */
  async photoSubmit(ctx: AppCtx, file?: Upload) {
    if (!file) throw appError(400, 'Take a photo first');
    const photoKey = await this.store(ctx, 'binds', file);
    const open = await this.db.fieldPhotoUpdate.findFirst({ where: { workerId: ctx.worker.id, status: { in: OPEN_PHOTO } }, orderBy: { createdAt: 'desc' } });
    const data = { status: 'PENDING', photoKey, submittedAt: new Date() };
    const row = open ? await this.db.fieldPhotoUpdate.update({ where: { id: open.id }, data }) : await this.db.fieldPhotoUpdate.create({ data: { ...data, organizationId: ctx.organizationId, workerId: ctx.worker.id } });
    if (open?.setVerify) {
      ctx.profile = await this.db.fieldWorkerProfile.update({ where: { workerId: ctx.worker.id }, data: { verifyRequested: false } });
    }
    return { status: await this.photoStatus(ctx), photoUpdateId: row.id };
  }

  /** Withdraw my own update while it waits (the office's request cannot be withdrawn). */
  async photoWithdraw(ctx: AppCtx) {
    const open = await this.db.fieldPhotoUpdate.findFirst({ where: { workerId: ctx.worker.id, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    if (open) {
      await this.db.fieldPhotoUpdate.update({ where: { id: open.id }, data: open.requestedById || open.auto ? { status: 'REQUESTED', photoKey: null, submittedAt: null } : { status: 'CANCELLED' } });
      if (open.photoKey) this.discard(open.photoKey);
    }
    return this.photoStatus(ctx);
  }

  // ── My payslip ────────────────────────────────────────────────────────────

  async payslip(ctx: AppCtx, month?: string) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) throw appError(400, 'Invalid month (YYYY-MM)');
    // Pay is private: shown only to workers the office switched on (HR > Payroll > App payslip).
    if (!ctx.profile.payslipVisible) throw appError(403, 'PAYSLIP_HIDDEN', { message: 'Your payslip is not shown in the app. Ask your admin if you need it.' });
    const result = await computeMonthlyPayroll(this.db, ctx.organizationId, month, ctx.worker.id);
    return { month: result.month, payslip: result.workers[0] ?? null };
  }

  // ── My jobs ───────────────────────────────────────────────────────────────

  async jobsMine(ctx: AppCtx, q: { from?: string; to?: string }) {
    const me = ctx.worker.id;
    const today = todayIn(ctx.settings.timezone || 'Asia/Singapore');
    const from = q.from && dateRe.test(q.from) ? q.from : today;
    let to = q.to && dateRe.test(q.to) ? q.to : addDays(from, 13);
    if (to < from) to = from;
    if (to > addDays(from, 62)) to = addDays(from, 62);
    const mine = await this.db.fieldJobCrew.findMany({ where: { workerId: me }, select: { jobId: true } });
    const jobs: any[] = mine.length ? await this.db.fieldJob.findMany({ where: { id: { in: mine.map((m: any) => m.jobId) }, date: { gte: from, lte: to }, siteId: { not: null }, ...liveJob } }) : [];
    const jobIds = jobs.map((j) => j.id);
    const [sites, crewRows, punches, notes, teams] = await Promise.all([
      this.db.fieldSite.findMany({ where: { id: { in: [...new Set(jobs.map((j) => j.siteId))] } } }),
      jobIds.length ? this.db.fieldJobCrew.findMany({ where: { jobId: { in: jobIds } } }) : [],
      jobIds.length ? this.db.fieldPunch.findMany({ where: { jobId: { in: jobIds }, status: { not: 'REJECTED' } }, orderBy: { serverTime: 'asc' } }) : [],
      jobs.length ? this.db.fieldDayNote.findMany({ where: { organizationId: ctx.organizationId, date: { in: [...new Set(jobs.map((j) => j.date))] } } }) : [],
      this.db.workerTeam.findMany({ where: { id: { in: [...new Set(jobs.flatMap((j) => j.teamIds))] } }, select: { id: true, name: true } }),
    ]);
    const crewWorkers = crewRows.length ? await this.db.worker.findMany({ where: { id: { in: [...new Set(crewRows.map((c: any) => c.workerId))] } }, select: { id: true, name: true, organizationId: true } }) : [];
    const otherOrgIds = [...new Set([...jobs.map((j) => j.organizationId), ...crewWorkers.map((w: any) => w.organizationId)].filter((id) => id !== ctx.organizationId))];
    const orgs = otherOrgIds.length ? await this.db.organization.findMany({ where: { id: { in: otherOrgIds } }, select: { id: true, name: true } }) : [];
    const orgName = new Map<string, string>(orgs.map((o: any) => [o.id, o.name]));
    const siteById = new Map<string, any>(sites.map((s: any) => [s.id, s]));
    const wById = new Map<string, any>(crewWorkers.map((w: any) => [w.id, w]));
    const teamName = new Map<string, string>(teams.map((t: any) => [t.id, t.name]));
    const ruleOn = new Map<string, WorkerClocking>();
    const shown = [];
    const sorted = jobs.slice().sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '99').localeCompare(b.startTime ?? '99') || a.createdAt.getTime() - b.createdAt.getTime());
    for (const j of sorted) {
      const site = siteById.get(j.siteId);
      if (!site) continue;
      const k = `${j.organizationId}|${j.date}`;
      if (!ruleOn.has(k)) ruleOn.set(k, await workerClocking(this.db, j.organizationId, me, j.date));
      const crew = crewRows.filter((c: any) => c.jobId === j.id);
      const jp = punches.filter((p: any) => p.jobId === j.id).map((p: any) => ({ workerId: p.workerId, type: p.type, serverTime: p.serverTime, status: p.status, insideFence: p.insideFence, distanceM: p.distanceM, autoLeft: p.autoLeft }));
      const usualStart = !j.startTime && !j.allDay ? (await matchShift(this.db, ctx.organizationId, me, j.siteId, j.date))?.template.startTime ?? null : null;
      shown.push({
        id: j.id,
        date: j.date,
        startTime: j.startTime,
        allDay: j.allDay,
        title: j.title,
        location: j.location,
        description: j.description,
        instructions: j.instructions,
        expectedMinutes: j.expectedMinutes,
        clocking: jobClockingOf(j, ruleOn.get(k)!),
        qrRequired: j.qrRequired,
        address: site.address,
        lat: site.lat,
        lng: site.lng,
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${site.lat},${site.lng}`,
        teams: j.teamIds.filter((t: string) => teamName.has(t)).map((t: string) => ({ id: t, name: teamName.get(t)! })),
        status: jobStatus(crew, jp),
        fromCompany: j.organizationId !== ctx.organizationId ? orgName.get(j.organizationId) ?? null : null,
        siteId: site.id,
        usualStart,
        photosEnabled: false,
        deliveryEnabled: false,
        crew: crew
          .map((c: any) => {
            const w = wById.get(c.workerId);
            return { userId: c.workerId, name: w?.name ?? '', teamId: c.teamId, fromCompany: w && w.organizationId !== ctx.organizationId ? orgName.get(w.organizationId) ?? null : null, me: c.workerId === me, ...visitFor(jp, c.workerId) };
          })
          .sort((a: any, b: any) => a.name.localeCompare(b.name)),
      });
    }
    const groupClocking = !!ctx.settings.groupJobClocking && (ctx.settings.groupClockBy === 'ANYONE' || (await this.isLeader(ctx)));
    return { from, to, today, jobClocking: (await workerClocking(this.db, ctx.organizationId, me, today)).rule, groupClocking, jobs: shown, notes: Object.fromEntries(notes.map((n: any) => [n.date, n.text])) };
  }
}
