/**
 * Field > Clock-ins (FIELD_PLAN.md phase 3). Ported from siteclock @62b7d9d src/modules/punches/punches.router.ts
 * (flagged, marked, face-log, approve, reject), src/modules/sites/sites.router.ts (present, pulse) and the
 * engine (engine.ts). Office side only: punches come from the worker app (SiteClock today, the AIMS app later).
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { FieldCtx, mayReview, reviewScope } from '../common/field-context.service';
import { haversineM } from '../common/geo';
import { localDate, localTimeToUtc } from '../common/time';
import { ClockInRequiredError, FieldEngine, NotFlaggedError, PunchTimeInvalidError } from '../engine/engine';
import { matchShift } from '../jobs/jobs-lib';

/** Off-site / unassigned / QR-missing / poor GPS: shown on Marked when Rules > Off-site clock-ins is "mark only". */
export const LOCATION_FLAGS: ReadonlySet<string> = new Set(['OUTSIDE_FENCE', 'POOR_ACCURACY', 'NOT_ASSIGNED', 'QR_MISSING']);

@Injectable()
export class FieldPunchesService {
  constructor(private readonly prisma: PrismaService) {}
  private get db(): any {
    return this.prisma as any;
  }

  /** Worker / site / job names for punch rows. */
  private async decorate(org: string, punches: any[]) {
    const [workers, sites, jobs] = await Promise.all([
      this.db.worker.findMany({ where: { id: { in: [...new Set(punches.flatMap((p) => [p.workerId, p.recordedByWorkerId]).filter(Boolean))] } }, select: { id: true, name: true } }),
      this.db.fieldSite.findMany({ where: { id: { in: [...new Set(punches.map((p) => p.siteId))] } }, select: { id: true, name: true, timezone: true, lat: true, lng: true, radiusM: true } }),
      this.db.fieldJob.findMany({ where: { id: { in: [...new Set(punches.map((p) => p.jobId).filter(Boolean))] } }, select: { id: true, title: true } }),
    ]);
    const w = new Map(workers.map((x: any) => [x.id, x.name]));
    const s = new Map(sites.map((x: any) => [x.id, x]));
    const j = new Map(jobs.map((x: any) => [x.id, x]));
    const emp = new Map((await this.db.fieldWorkerProfile.findMany({ where: { organizationId: org, workerId: { in: punches.map((p) => p.workerId) } }, select: { workerId: true, employeeNo: true } })).map((p: any) => [p.workerId, p.employeeNo]));
    return punches.map(({ photoKey, deviceId, idempotencyKey, ...p }) => ({
      ...p,
      hasPhoto: !!photoKey,
      photoCopied: !!photoKey && !String(photoKey).startsWith('siteclock:'),
      worker: { id: p.workerId, name: w.get(p.workerId) ?? '', employeeNo: emp.get(p.workerId) ?? null },
      site: s.get(p.siteId) ?? null,
      job: p.jobId ? j.get(p.jobId) ?? null : null,
      recordedBy: p.recordedByWorkerId ? { id: p.recordedByWorkerId, name: w.get(p.recordedByWorkerId) ?? '' } : null,
    }));
  }

  /** Punch list with filters (dates as local days in the org zone). */
  async list(ctx: FieldCtx, q: { from?: string; to?: string; workerId?: string; siteId?: string; status?: string; flagReason?: string }) {
    const d = /^\d{4}-\d{2}-\d{2}$/;
    const from = q.from && d.test(q.from) ? DateTime.fromISO(q.from, { zone: ctx.timezone }).startOf('day').toJSDate() : DateTime.now().setZone(ctx.timezone).minus({ days: 7 }).startOf('day').toJSDate();
    const to = q.to && d.test(q.to) ? DateTime.fromISO(q.to, { zone: ctx.timezone }).endOf('day').toJSDate() : new Date();
    const punches = await this.db.fieldPunch.findMany({
      where: {
        organizationId: ctx.organizationId,
        serverTime: { gte: from, lte: to },
        ...(q.workerId ? { workerId: q.workerId } : {}),
        ...(q.siteId ? { siteId: q.siteId } : {}),
        ...(q.status ? { status: { in: q.status.split(',') } } : {}),
        ...(q.flagReason ? { flagReason: q.flagReason } : {}),
        ...reviewScope(ctx, 'punches'),
      },
      orderBy: { serverTime: 'desc' },
      take: 1000,
    });
    return { punches: await this.decorate(ctx.organizationId, punches) };
  }

  /** Flagged punches; a missed clock-in says whether the reviewer must give the start (and suggests the shift start). */
  async flagged(ctx: FieldCtx) {
    const punches = await this.db.fieldPunch.findMany({ where: { organizationId: ctx.organizationId, status: 'FLAGGED', ...reviewScope(ctx, 'punches') }, orderBy: { serverTime: 'desc' } });
    const engine = new FieldEngine(this.db);
    const rows = await this.decorate(ctx.organizationId, punches);
    return {
      punches: await Promise.all(
        rows.map(async (p: any) => {
          if (p.flagReason !== 'OUT_WITHOUT_IN' && p.flagReason !== 'AUTO_CLOSE_OVERRIDE') return p;
          const open = await engine.findOpenEntryForOut(p.workerId, p.siteId);
          const reclose = open ? null : await engine.findReclosableEntry(p.workerId, p.siteId, p.serverTime);
          const pairIn = open || reclose ? null : await engine.findPairableInPunch(p.workerId, p.siteId, p.serverTime);
          if (open || reclose || pairIn) return { ...p, needsClockIn: false, suggestedClockInAt: null };
          const tz = p.site?.timezone ?? ctx.timezone;
          const workDate = localDate(p.serverTime, tz);
          const shift = await matchShift(this.db, ctx.organizationId, p.workerId, p.siteId, workDate);
          const suggested = shift ? localTimeToUtc(workDate, shift.template.startTime, tz) : null;
          return { ...p, needsClockIn: true, suggestedClockInAt: suggested && suggested < p.serverTime ? suggested : null };
        }),
      ),
    };
  }

  /** Punches recorded off-site without review (Rules > Off-site: mark only), last 30 days. */
  async marked(ctx: FieldCtx) {
    const punches = await this.db.fieldPunch.findMany({
      where: { organizationId: ctx.organizationId, status: 'OK', flagReason: { in: [...LOCATION_FLAGS] }, serverTime: { gte: new Date(Date.now() - 30 * 86400_000) }, ...reviewScope(ctx, 'punches') },
      orderBy: { serverTime: 'desc' },
      take: 300,
    });
    return { punches: await this.decorate(ctx.organizationId, punches) };
  }

  /** Punches with a face check result, last 7 days (oddity: FACE_MISMATCH never flags a punch). */
  async faceLog(ctx: FieldCtx) {
    const punches = await this.db.fieldPunch.findMany({
      where: { organizationId: ctx.organizationId, serverTime: { gte: new Date(Date.now() - 7 * 86400_000) }, faceResult: { not: null }, ...reviewScope(ctx, 'punches') },
      orderBy: { serverTime: 'desc' },
      take: 200,
    });
    return { punches: await this.decorate(ctx.organizationId, punches) };
  }

  private async reviewable(ctx: FieldCtx, id: string) {
    const p = await this.db.fieldPunch.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!p || !mayReview(ctx, 'punches', p.siteId, p.workerId)) throw new NotFoundException('Not found');
    if (p.status !== 'FLAGGED') throw new ConflictException('Punch not pending review');
    return p;
  }

  async approve(ctx: FieldCtx, id: string, body: unknown) {
    const b = z.object({ clockInAt: z.string().datetime().optional(), punchAt: z.string().datetime().optional(), note: z.string().max(300).optional() }).safeParse(body ?? {});
    if (!b.success) throw new BadRequestException({ message: 'Check the times', error: b.error.flatten() });
    const p = await this.reviewable(ctx, id);
    const engine = new FieldEngine(this.db);
    try {
      const out = await engine.approvePunch(p.id, { id: ctx.userId, name: ctx.userName }, b.data.clockInAt ? new Date(b.data.clockInAt) : undefined, b.data.note, b.data.punchAt ? new Date(b.data.punchAt) : undefined);
      return { ...out, events: engine.events, before: b.data.punchAt ? { serverTime: p.serverTime } : undefined };
    } catch (e) {
      if (e instanceof PunchTimeInvalidError) throw new BadRequestException(e.message);
      if (e instanceof ClockInRequiredError) throw new BadRequestException({ message: 'Give the time they started', code: 'CLOCK_IN_REQUIRED' });
      if (e instanceof NotFlaggedError) throw new ConflictException('Punch not pending review');
      throw e;
    }
  }

  async reject(ctx: FieldCtx, id: string, body: any) {
    const p = await this.reviewable(ctx, id);
    const note = typeof body?.note === 'string' ? body.note.slice(0, 300) : undefined;
    return new FieldEngine(this.db).rejectPunch(p.id, { id: ctx.userId, name: ctx.userName }, note);
  }

  /** The selfie: only once the files are copied from SiteClock (imported rows keep a "siteclock:" path until then). */
  async photo(ctx: FieldCtx, id: string) {
    const p = await this.db.fieldPunch.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!p || !mayReview(ctx, 'punches', p.siteId, p.workerId)) throw new NotFoundException('Not found');
    if (!p.photoKey) throw new NotFoundException('No photo');
    if (String(p.photoKey).startsWith('siteclock:')) throw new NotFoundException('This photo is still in SiteClock and has not been copied yet');
    throw new ForbiddenException('Photos taken in AIMS come with the AIMS phone app');
  }

  /** Who is on site now (OPEN entries) per site, and a site's pulse (people with clock-in GPS and inside the fence). */
  async live(ctx: FieldCtx) {
    const open = await this.db.fieldTimeEntry.findMany({ where: { organizationId: ctx.organizationId, status: 'OPEN', ...reviewScope(ctx, 'punches') }, orderBy: { clockInAt: 'asc' } });
    const sites = await this.db.fieldSite.findMany({ where: { organizationId: ctx.organizationId, id: { in: [...new Set(open.map((e: any) => e.siteId))] } } });
    const workers = await this.db.worker.findMany({ where: { id: { in: open.map((e: any) => e.workerId) } }, select: { id: true, name: true } });
    const ins = open.length ? await this.db.fieldPunch.findMany({ where: { timeEntryId: { in: open.map((e: any) => e.id) }, type: 'IN' } }) : [];
    const wName = new Map(workers.map((w: any) => [w.id, w.name]));
    return {
      sites: sites
        .map((s: any) => ({
          id: s.id,
          name: s.name,
          lat: s.lat,
          lng: s.lng,
          radiusM: s.radiusM,
          people: open
            .filter((e: any) => e.siteId === s.id)
            .map((e: any) => {
              const p = ins.find((x: any) => x.timeEntryId === e.id);
              return { entryId: e.id, workerId: e.workerId, name: wName.get(e.workerId) ?? '', clockInAt: e.clockInAt, lat: p?.lat ?? null, lng: p?.lng ?? null, insideFence: p ? haversineM(p.lat, p.lng, s.lat, s.lng) <= s.radiusM : null };
            }),
        }))
        .sort((a: any, b: any) => b.people.length - a.people.length || a.name.localeCompare(b.name)),
    };
  }
}
