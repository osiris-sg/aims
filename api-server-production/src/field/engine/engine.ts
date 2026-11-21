/**
 * The Field time engine (FIELD_PLAN.md phases 3-4). Ported line by line from siteclock backend @62b7d9d:
 *   src/modules/timesheets/timesheets.service.ts   computeEntry, crewSpan, workedForSplit
 *   src/modules/punches/punches.service.ts         applyPunchEffect, autoLeavePreviousJobs, closeStaleEntry,
 *                                                  findOpenEntryForOut, closedEntryOf, findPairableInPunch,
 *                                                  findReclosableEntry, approvePunch, rejectPunch
 *   src/lib/missedClockOut.ts                      missedClockOutTime
 *   src/jobs/autoclose.ts                          autoCloseStaleEntries
 * Same rules, same order, oddities included (FIELD_PLAN.md §6.1: NLB credit 0, editedById overload, weekly OT
 * cap only). Differences: Field tables (worker = Worker id, org = organization id); no socket events and no
 * pushes (office side only); audit actions are returned to the caller for the Activity Log; a reviewer is an
 * AIMS user (id + name). Crew notes keep SiteClock's exact wording, so imported and computed entries read alike.
 */
import { addDays, localDate, localTimeToUtc, minutesBetween } from '../common/time';
import { haversineM } from '../common/geo';
import { jobClockingOf, matchShift, workerClocking } from '../jobs/jobs-lib';

type Db = any;
export type AuditEvent = { action: string; entity: string; entityId: string | null; before?: unknown; after?: unknown };
export type Reviewer = { id: string; name: string };

/** Job filter: everything except cancelled jobs (lib/externalJobs.ts liveJob). */
const liveJob = { NOT: { status: 'CANCELLED' } };
const fmtMin = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim());

export class ClockInRequiredError extends Error {
  constructor() {
    super('CLOCK_IN_REQUIRED');
  }
}
export class PunchTimeInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PunchTimeInvalidError';
  }
}
export class NotFlaggedError extends Error {
  constructor() {
    super('NOT_FLAGGED');
  }
}

type CrewSpan = { paidStart: Date; paidEnd: Date; crewFirst: Date | null; crewLast: Date | null; needsReview: boolean; note: string | null };

const RECLOSE_WINDOW_H = 24;
const PAIR_WINDOW_H = 24;

export class FieldEngine {
  /** Audit actions written by the last call(s); the caller moves them into the Activity Log. */
  events: AuditEvent[] = [];
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  private async site(id: string) {
    return this.db.fieldSite.findUnique({ where: { id } });
  }

  // ── computeEntry ──────────────────────────────────────────────────────────

  /** Compute gross / break / regular / OT / late for a closed entry and persist (snapshot semantics). */
  async computeEntry(tx: Db, entryId: string, finalStatus: 'PENDING' | 'AUTO_CLOSED' = 'PENDING') {
    const entry = await tx.fieldTimeEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new Error('computeEntry: entry not found');
    if (!entry.clockOutAt) throw new Error('computeEntry: entry not closed');
    const site = await tx.fieldSite.findUnique({ where: { id: entry.siteId } });
    const tz = site?.timezone ?? 'Asia/Singapore';

    // schedule -> early / late (paid time starts at the shift start; early is informational)
    const shift = await matchShift(tx, entry.organizationId, entry.workerId, entry.siteId, entry.workDate);
    let lateMinutes = 0;
    let earlyMinutes = 0;
    let leftEarlyMinutes = 0;
    let paidStart: Date = entry.clockInAt;
    const otRulesEarly = await tx.fieldOvertimeRule.findMany({ where: { organizationId: entry.organizationId, OR: [{ siteId: entry.siteId }, { siteId: null }] } });
    const otRulePre = otRulesEarly.find((r: any) => r.siteId === entry.siteId) ?? otRulesEarly.find((r: any) => !r.siteId);
    if (shift) {
      const expectedStart = localTimeToUtc(entry.workDate, shift.template.startTime, tz);
      lateMinutes = Math.max(0, minutesBetween(expectedStart, entry.clockInAt) - shift.template.graceLateMin);
      earlyMinutes = Math.max(0, minutesBetween(entry.clockInAt, expectedStart));
      // Early-clock-in mode: template override, else rule, else legacy booleans.
      const earlyMode =
        shift.template.earlyMode ??
        (shift.template.payEarly === true ? 'pay' : shift.template.payEarly === false ? 'clamp' : null) ??
        otRulePre?.earlyMode ??
        (otRulePre?.countEarlyAsWork ? 'pay' : 'clamp');
      if (earlyMinutes > 0 && earlyMode === 'clamp') paidStart = expectedStart;
      let expectedEnd = localTimeToUtc(entry.workDate, shift.template.endTime, tz);
      if (expectedEnd <= expectedStart) expectedEnd = new Date(expectedEnd.getTime() + 24 * 3600_000); // crosses midnight
      if (earlyMinutes > 0 && earlyMode === 'slide') expectedEnd = new Date(expectedEnd.getTime() - earlyMinutes * 60_000);
      leftEarlyMinutes = Math.max(0, minutesBetween(entry.clockOutAt, expectedEnd));
    }

    // Paid hours follow the crew's jobs; an office edit is final (editedById set: crew logic skipped).
    let paidEnd: Date = entry.clockOutAt;
    const crew = await this.crewSpan(tx, entry);
    if (crew) {
      paidStart = crew.paidStart > paidStart ? crew.paidStart : paidStart;
      paidEnd = crew.paidEnd;
    }
    const gross = Math.max(0, minutesBetween(paidStart, paidEnd));
    const workedFor = await this.workedForSplit(tx, entry, paidStart, paidEnd);

    // break rule: site-specific over company-wide; an approved no-lunch-break day credits part of the deduction back
    const breakRules = await tx.fieldBreakRule.findMany({ where: { organizationId: entry.organizationId, OR: [{ siteId: entry.siteId }, { siteId: null }] } });
    const breakRule = breakRules.find((r: any) => r.siteId === entry.siteId) ?? breakRules.find((r: any) => !r.siteId);
    const deduct = breakRule && entry.nlb ? Math.max(0, breakRule.deductMinutes - breakRule.nlbCreditMinutes) : breakRule?.deductMinutes ?? 0;
    const breakMin = breakRule && gross >= breakRule.minShiftMinutes ? deduct : 0;
    const net = Math.max(0, gross - breakMin);

    const otRule = otRulePre;
    const threshold = otRule?.dailyThresholdMin ?? 528;
    let ot = Math.max(0, net - threshold);
    // weekly OT cap: OT already booked this week (Mon-Sun of workDate) eats into the cap; the rest is regular.
    if (otRule?.weeklyCapOtMin != null && ot > 0) {
      const d = new Date(entry.workDate + 'T00:00:00Z');
      const dow = (d.getUTCDay() + 6) % 7;
      const monday = new Date(d.getTime() - dow * 86400_000);
      const sunday = new Date(monday.getTime() + 6 * 86400_000);
      const ymdOf = (x: Date) => x.toISOString().slice(0, 10);
      const rows = await tx.fieldTimeEntry.findMany({
        where: { workerId: entry.workerId, workDate: { gte: ymdOf(monday), lte: ymdOf(sunday) }, id: { not: entry.id }, status: { not: 'REJECTED' } },
        select: { otMinutes: true },
      });
      const alreadyOt = rows.reduce((n: number, r: any) => n + (r.otMinutes ?? 0), 0);
      ot = Math.min(ot, Math.max(0, otRule.weeklyCapOtMin - alreadyOt));
    }
    const regular = net - ot;

    return tx.fieldTimeEntry.update({
      where: { id: entry.id },
      data: {
        status: finalStatus,
        grossMinutes: gross,
        breakMinutes: breakMin,
        regularMinutes: regular,
        otMinutes: ot,
        otMultiplier: otRule?.otMultiplier ?? 1.5,
        lateMinutes,
        earlyMinutes,
        leftEarlyMinutes,
        shiftAssignmentId: shift?.id ?? null,
        paidFromAt: crew?.paidStart ?? null,
        paidToAt: crew?.paidEnd ?? null,
        crewFirstInAt: crew?.crewFirst ?? null,
        crewLastOutAt: crew?.crewLast ?? null,
        needsReview: crew?.needsReview ?? false,
        workedFor: workedFor ?? null,
        crewNote: crew?.note ?? null,
      },
    });
  }

  /**
   * Shared workers: minutes of the paid span on linked orgs' jobs ({ organizationId: minutes }, null when none),
   * from this worker's own job arrivals / leaves; a once-a-day crew whose jobs are all one linked org's is that org's whole day.
   */
  async workedForSplit(tx: Db, entry: any, paidStart: Date, paidEnd: Date): Promise<Record<string, number> | null> {
    if (!entry.clockOutAt) return null;
    const window = { gte: new Date(entry.clockInAt.getTime() - 6 * 3600_000), lte: new Date(entry.clockOutAt.getTime() + 6 * 3600_000) };
    const punches = await tx.fieldPunch.findMany({ where: { workerId: entry.workerId, jobId: { not: null }, status: { not: 'REJECTED' }, serverTime: window }, orderBy: { serverTime: 'asc' } });
    const jobOrg = new Map<string, string>();
    if (punches.length) {
      const jobs = await tx.fieldJob.findMany({ where: { id: { in: [...new Set(punches.map((p: any) => p.jobId))] } }, select: { id: true, organizationId: true } });
      for (const j of jobs) jobOrg.set(j.id, j.organizationId);
    }
    const out: Record<string, number> = {};
    const add = (org: string, from: Date, to: Date) => {
      const s = Math.max(from.getTime(), paidStart.getTime());
      const e = Math.min(to.getTime(), paidEnd.getTime());
      if (e > s) out[org] = (out[org] ?? 0) + Math.round((e - s) / 60_000);
    };
    if (punches.length) {
      punches.forEach((p: any, i: number) => {
        const org = jobOrg.get(p.jobId);
        if (p.type !== 'IN' || !org || org === entry.organizationId) return;
        const rest = punches.slice(i + 1);
        const end = rest.find((q: any) => q.jobId === p.jobId && q.type === 'OUT')?.serverTime ?? rest.find((q: any) => q.type === 'IN' && q.jobId !== p.jobId)?.serverTime ?? entry.clockOutAt;
        add(org, p.serverTime, end);
      });
    } else {
      const mine = await tx.fieldJobCrew.findMany({ where: { workerId: entry.workerId }, select: { jobId: true } });
      const jobs = mine.length
        ? await tx.fieldJob.findMany({ where: { id: { in: mine.map((m: any) => m.jobId) }, date: { in: [entry.workDate, addDays(entry.workDate, 1)] }, ...liveJob }, select: { organizationId: true } })
        : [];
      const orgs = [...new Set(jobs.map((j: any) => j.organizationId))];
      if (orgs.length === 1 && orgs[0] !== entry.organizationId) add(orgs[0] as string, paidStart, paidEnd);
    }
    return Object.keys(out).length ? out : null;
  }

  /** Paid hours follow the crew's jobs (FieldWorkerProfile.payFollowsCrew); null when it does not apply or an office edit exists. */
  async crewSpan(tx: Db, entry: any): Promise<CrewSpan | null> {
    if (!entry.clockOutAt || entry.editedById) return null;
    const prof = await tx.fieldWorkerProfile.findUnique({ where: { workerId: entry.workerId } });
    if (!prof?.payFollowsCrew) return null;
    const co = await tx.fieldSettings.findUnique({ where: { organizationId: entry.organizationId } });
    const beforeMin = prof.crewMarginBeforeMin ?? co?.crewMarginBeforeMin ?? 15;
    const afterMin = prof.crewMarginAfterMin ?? co?.crewMarginAfterMin ?? 30;
    const own: CrewSpan = { paidStart: entry.clockInAt, paidEnd: entry.clockOutAt, crewFirst: null, crewLast: null, needsReview: true, note: null };

    const mine = await tx.fieldJobCrew.findMany({ where: { workerId: entry.workerId }, select: { jobId: true } });
    const jobs = mine.length
      ? await tx.fieldJob.findMany({ where: { organizationId: entry.organizationId, id: { in: mine.map((m: any) => m.jobId) }, date: { in: [entry.workDate, addDays(entry.workDate, 1)] }, ...liveJob }, select: { id: true, siteId: true } })
      : [];
    if (!jobs.length) return { ...own, note: "Not on any job's crew this day — paid as clocked. Check the hours." };
    const crewRows = await tx.fieldJobCrew.findMany({ where: { jobId: { in: jobs.map((j: any) => j.id) } }, select: { workerId: true } });
    const crewIds = [...new Set<string>(crewRows.map((c: any) => c.workerId).filter((id: string) => id !== entry.workerId))];
    const window = { gte: new Date(entry.clockInAt.getTime() - 6 * 3600_000), lte: new Date(entry.clockOutAt.getTime() + 6 * 3600_000) };
    const jobIds = jobs.map((j: any) => j.id);
    const clockings = await tx.fieldPunch.findMany({
      where: {
        status: { not: 'REJECTED' },
        serverTime: window,
        OR: [
          ...(crewIds.length ? [{ workerId: { in: crewIds }, jobId: { in: jobIds } }, { workerId: { in: crewIds }, jobId: null, siteId: { in: jobs.map((j: any) => j.siteId) } }] : []),
          { workerId: entry.workerId, jobId: { in: jobIds } },
        ],
      },
      select: { serverTime: true },
      orderBy: { serverTime: 'asc' },
    });
    if (!clockings.length)
      return { ...own, note: crewIds.length ? 'No clockings on this day\'s jobs, by the crew or by them — paid as clocked. Check the hours.' : 'No one else on the crew and no job clockings of their own this day — paid as clocked. Check the hours.' };
    const crewFirst: Date = clockings[0].serverTime;
    const crewLast: Date = clockings[clockings.length - 1].serverTime;
    const fromCrew = new Date(crewFirst.getTime() - beforeMin * 60_000);
    const toCrew = new Date(crewLast.getTime() + afterMin * 60_000);
    const paidStart = fromCrew > entry.clockInAt ? fromCrew : entry.clockInAt;
    const paidEnd = toCrew < entry.clockOutAt ? toCrew : entry.clockOutAt;
    if (paidEnd <= paidStart) return { ...own, crewFirst, crewLast, note: "The crew's clockings fall outside this worker's own — paid as clocked. Check the hours." };
    const cutBefore = minutesBetween(entry.clockInAt, paidStart);
    const cutAfter = minutesBetween(paidEnd, entry.clockOutAt);
    const notes: string[] = [];
    if (cutBefore > 0) notes.push(`Clocked in ${fmtMin(cutBefore + beforeMin)} before the crew's first job clock-in; ${fmtMin(beforeMin)} paid.`);
    if (cutAfter > 0) notes.push(`Clocked out ${fmtMin(cutAfter + afterMin)} after the crew's last job clock-out; ${fmtMin(afterMin)} paid.`);
    return { paidStart, paidEnd, crewFirst, crewLast, needsReview: notes.length > 0, note: notes.length ? notes.join(' ') : null };
  }

  // ── Missed clock-out / auto-close ─────────────────────────────────────────

  /** When a day left open closes (Rules > Missed clock-out), never later than `cap`. */
  async missedClockOutTime(entry: any, site: any, cap: Date) {
    const co = await this.db.fieldSettings.findUnique({ where: { organizationId: entry.organizationId }, select: { missedClockOut: true } });
    const rule: string = co?.missedClockOut ?? 'FULL_SHIFT';
    const shift = rule === 'NO_HOURS' ? null : await matchShift(this.db, entry.organizationId, entry.workerId, entry.siteId, entry.workDate);
    const tz = site?.timezone ?? 'Asia/Singapore';
    const bounds = (t: { startTime: string; endTime: string }) => {
      const start = localTimeToUtc(entry.workDate, t.startTime, tz);
      let end = localTimeToUtc(entry.workDate, t.endTime, tz);
      if (end <= start) end = new Date(end.getTime() + 24 * 3600_000);
      return { start, end };
    };
    let closeAt: Date;
    let basis: string;
    if (rule === 'FULL_SHIFT') {
      closeAt = new Date(entry.clockInAt.getTime() + site.autoCloseAfterH * 3600_000);
      basis = 'window';
      if (shift) {
        const { start, end } = bounds(shift.template);
        closeAt = new Date(entry.clockInAt.getTime() + minutesBetween(start, end) * 60_000);
        basis = 'shift_length';
      }
    } else if (rule === 'SHIFT_END' && shift) {
      const { end } = bounds(shift.template);
      closeAt = end > entry.clockInAt ? end : entry.clockInAt;
      basis = 'shift_end';
    } else {
      const last = await this.db.fieldPunch.findFirst({
        where: { timeEntryId: entry.id, jobId: { not: null }, status: 'OK', serverTime: { gt: entry.clockInAt } },
        orderBy: { serverTime: 'desc' },
        select: { serverTime: true },
      });
      closeAt = last?.serverTime ?? entry.clockInAt;
      basis = last ? 'last_job_clocking' : 'no_hours';
    }
    if (closeAt > cap) closeAt = cap;
    return { closeAt, basis, rule };
  }

  /** Close OPEN entries of one org older than their site's autoCloseAfterH (autoclose.ts; the cron is gated by fieldEngineLive). */
  async autoCloseStaleEntries(organizationId: string) {
    const open = await this.db.fieldTimeEntry.findMany({ where: { organizationId, status: 'OPEN' } });
    const now = this.now().getTime();
    let closed = 0;
    for (const entry of open) {
      const site = await this.site(entry.siteId);
      if (!site) continue;
      if ((now - entry.clockInAt.getTime()) / 3600_000 < site.autoCloseAfterH) continue;
      const { closeAt, basis, rule } = await this.missedClockOutTime(entry, site, new Date(now));
      await this.db.$transaction(async (tx: Db) => {
        await tx.fieldTimeEntry.update({ where: { id: entry.id }, data: { clockOutAt: closeAt } });
        await this.computeEntry(tx, entry.id, 'AUTO_CLOSED');
      });
      this.events.push({ action: 'ENTRY_AUTO_CLOSE', entity: 'TimeEntry', entityId: entry.id, before: { status: 'OPEN', clockInAt: entry.clockInAt }, after: { status: 'AUTO_CLOSED', clockOutAt: closeAt, autoCloseAfterH: site.autoCloseAfterH, rule, basis } });
      closed++;
    }
    return closed;
  }

  // ── Punch effects ─────────────────────────────────────────────────────────

  /** The open entry an OUT at siteId closes: opened here, or the open entry from elsewhere when this site is one of their JOB places that day (or the next). */
  async findOpenEntryForOut(workerId: string, siteId: string) {
    const same = await this.db.fieldTimeEntry.findFirst({ where: { workerId, siteId, status: 'OPEN' }, orderBy: { clockInAt: 'desc' } });
    if (same) return same;
    const open = await this.db.fieldTimeEntry.findFirst({ where: { workerId, status: 'OPEN' }, orderBy: { clockInAt: 'desc' } });
    if (!open) return null;
    const site = await this.site(siteId);
    if (site?.kind !== 'JOB') return null;
    const mine = await this.db.fieldJobCrew.findMany({ where: { workerId }, select: { jobId: true } });
    const n = mine.length ? await this.db.fieldJob.count({ where: { id: { in: mine.map((m: any) => m.jobId) }, siteId, date: { in: [open.workDate, addDays(open.workDate, 1)] }, ...liveJob } }) : 0;
    return n ? open : null;
  }

  async findPairableInPunch(workerId: string, siteId: string, before: Date) {
    return this.db.fieldPunch.findFirst({
      where: { workerId, siteId, type: 'IN', status: 'FLAGGED', serverTime: { lt: before, gte: new Date(before.getTime() - PAIR_WINDOW_H * 3600_000) } },
      orderBy: { serverTime: 'desc' },
    });
  }

  async findReclosableEntry(workerId: string, siteId: string, before: Date) {
    return this.db.fieldTimeEntry.findFirst({
      where: { workerId, siteId, status: 'AUTO_CLOSED', clockInAt: { lt: before, gte: new Date(before.getTime() - RECLOSE_WINDOW_H * 3600_000) } },
      orderBy: { clockInAt: 'desc' },
    });
  }

  /** The closed entry this OUT punch already ended (closeStaleEntry), if any. */
  async closedEntryOf(punch: any) {
    if (!punch.timeEntryId) return null;
    const e = await this.db.fieldTimeEntry.findUnique({ where: { id: punch.timeEntryId } });
    return e && e.status !== 'OPEN' && e.clockOutAt ? e : null;
  }

  /** Close a day left OPEN before `before`: at the worker's unreviewed clock-out if any (PENDING), else Rules > Missed clock-out (AUTO_CLOSED). */
  async closeStaleEntry(entry: any, before: Date) {
    const site = await this.site(entry.siteId);
    const pendingOut = await this.db.fieldPunch.findFirst({
      where: { workerId: entry.workerId, type: 'OUT', status: 'FLAGGED', jobId: null, serverTime: { gt: entry.clockInAt, lt: before } },
      orderBy: { serverTime: 'desc' },
    });
    const auto = pendingOut ? null : await this.missedClockOutTime(entry, site, before);
    let closeAt: Date = pendingOut ? pendingOut.serverTime : auto!.closeAt;
    if (closeAt > before) closeAt = before;
    const status = pendingOut ? 'PENDING' : 'AUTO_CLOSED';
    const closed = await this.db.$transaction(async (tx: Db) => {
      await tx.fieldTimeEntry.update({
        where: { id: entry.id },
        data: { clockOutAt: closeAt, ...(pendingOut ? { editNote: "closed at the worker's clock-out (awaiting review) when the next day's clock-in arrived" } : {}) },
      });
      return this.computeEntry(tx, entry.id, status as any);
    });
    if (pendingOut) await this.db.fieldPunch.update({ where: { id: pendingOut.id }, data: { timeEntryId: entry.id } });
    this.events.push({
      action: pendingOut ? 'ENTRY_CLOSE_AT_PENDING_OUT' : 'ENTRY_AUTO_CLOSE',
      entity: 'TimeEntry',
      entityId: entry.id,
      before: { status: 'OPEN', clockInAt: entry.clockInAt },
      after: { status, clockOutAt: closeAt, ...(pendingOut ? { punchId: pendingOut.id } : { autoCloseAfterH: site?.autoCloseAfterH, rule: auto!.rule, basis: auto!.basis }) },
    });
    return closed;
  }

  /** Arriving at a job leaves the previous one (ARRIVE_LEAVE jobs): an OUT is written at the new arrival, marked autoLeft. */
  async autoLeavePreviousJobs(punch: any, site: any, entryId: string | null) {
    if (!punch.jobId || punch.type !== 'IN') return;
    const today = localDate(punch.serverTime, site.timezone);
    const rule = await workerClocking(this.db, punch.organizationId, punch.workerId, today);
    const mine = await this.db.fieldJobCrew.findMany({ where: { workerId: punch.workerId }, select: { jobId: true } });
    const jobs = mine.length
      ? await this.db.fieldJob.findMany({ where: { id: { in: mine.map((m: any) => m.jobId).filter((id: string) => id !== punch.jobId) }, date: { in: [addDays(today, -1), today, addDays(today, 1)] }, ...liveJob } })
      : [];
    for (const j of jobs) {
      if (jobClockingOf(j, rule) !== 'ARRIVE_LEAVE') continue;
      const js = j.siteId ? await this.site(j.siteId) : null;
      if (!js) continue;
      const ps = await this.db.fieldPunch.findMany({ where: { workerId: punch.workerId, jobId: j.id, status: { not: 'REJECTED' } }, orderBy: { serverTime: 'asc' } });
      const arrive = ps.find((p: any) => p.type === 'IN');
      if (!arrive || arrive.serverTime >= punch.serverTime) continue;
      if (ps.some((p: any) => p.type === 'OUT' && p.serverTime >= arrive.serverTime)) continue;
      const distanceM = Math.round(haversineM(punch.lat, punch.lng, js.lat, js.lng));
      await this.db.fieldPunch.create({
        data: {
          organizationId: punch.organizationId, workerId: punch.workerId, siteId: js.id, type: 'OUT', serverTime: punch.serverTime, lat: punch.lat, lng: punch.lng,
          accuracyM: punch.accuracyM, distanceM, insideFence: distanceM <= js.radiusM, deviceId: punch.deviceId, status: 'OK', jobId: j.id, autoLeft: true, timeEntryId: entryId,
        },
      });
    }
  }

  /** Open / close the time entry for an OK (or approved) punch, at punch.serverTime. */
  async applyPunchEffect(punch: any, site: any) {
    if (punch.jobId && !(punch.type === 'OUT' && punch.endsDay)) {
      const open = await this.db.fieldTimeEntry.findFirst({ where: { workerId: punch.workerId, status: 'OPEN' }, orderBy: { clockInAt: 'desc' } });
      if (open || punch.type === 'OUT') {
        if (open) await this.db.fieldPunch.update({ where: { id: punch.id }, data: { timeEntryId: open.id } });
        await this.autoLeavePreviousJobs(punch, site, open?.id ?? null);
        return open;
      }
    }
    if (punch.type === 'IN') {
      const today = localDate(punch.serverTime, site.timezone);
      const stale = await this.db.fieldTimeEntry.findMany({ where: { workerId: punch.workerId, status: 'OPEN', workDate: { lt: today } } });
      for (const e of stale) await this.closeStaleEntry(e, punch.serverTime);
      const existing = await this.db.fieldTimeEntry.findFirst({ where: { workerId: punch.workerId, siteId: site.id, status: 'OPEN' } });
      if (existing) {
        await this.db.fieldPunch.update({ where: { id: punch.id }, data: { timeEntryId: existing.id } });
        return existing;
      }
      const entry = await this.db.fieldTimeEntry.create({
        data: { organizationId: punch.organizationId, workerId: punch.workerId, siteId: site.id, workDate: localDate(punch.serverTime, site.timezone), clockInAt: punch.serverTime, status: 'OPEN' },
      });
      await this.db.fieldPunch.update({ where: { id: punch.id }, data: { timeEntryId: entry.id } });
      return entry;
    }
    const open = await this.findOpenEntryForOut(punch.workerId, site.id);
    if (!open) return null;
    const closeAt = punch.serverTime > open.clockInAt ? punch.serverTime : open.clockInAt;
    const entry = await this.db.$transaction(async (tx: Db) => {
      await tx.fieldTimeEntry.update({
        where: { id: open.id },
        data: { clockOutAt: closeAt, ...(open.siteId !== site.id ? { clockOutSiteId: site.id } : {}), ...(punch.nlbClaimed ? { nlbClaimed: true } : {}) },
      });
      return this.computeEntry(tx, open.id, 'PENDING');
    });
    await this.db.fieldPunch.update({ where: { id: punch.id }, data: { timeEntryId: entry.id } });
    return entry;
  }

  // ── Review ────────────────────────────────────────────────────────────────

  /**
   * Approve a flagged punch (punches.service approvePunch): optional corrected time (originalTime keeps what was
   * punched); an OUT with no open entry re-closes an auto-closed day, pairs with a flagged IN, or needs the
   * reviewer's clock-in time (missed clock-in, CLOCK_IN_REQUIRED). Device trust and photo-on-record follow.
   */
  async approvePunch(punchId: string, reviewer: Reviewer, clockInAt?: Date, reviewNote?: string, punchAt?: Date) {
    const punch = await this.db.fieldPunch.findUnique({ where: { id: punchId } });
    if (!punch) throw new Error('NOT_FOUND');
    if (punch.status !== 'FLAGGED') throw new NotFlaggedError();
    const site = await this.site(punch.siteId);
    const recordedTime: Date = punch.serverTime;
    let timeEdited = false;
    if (punchAt && !isNaN(punchAt.getTime()) && Math.abs(punchAt.getTime() - recordedTime.getTime()) >= 60_000) {
      if (punchAt.getTime() > this.now().getTime() + 2 * 60_000) throw new PunchTimeInvalidError('The corrected time cannot be in the future');
      if (punch.type === 'OUT') {
        const own = await this.closedEntryOf(punch);
        const open = own ?? (await this.findOpenEntryForOut(punch.workerId, punch.siteId));
        if (open && punchAt <= open.clockInAt) throw new PunchTimeInvalidError('The corrected clock-out must be after the clock-in');
      }
      punch.serverTime = punchAt;
      timeEdited = true;
    }

    let missedIn = false;
    let recloseId: string | null = null;
    let recloseNote = 'auto-closed entry re-closed at real clock-out on punch approval';
    let pairIn: any = null;
    if (punch.type === 'OUT' && (!punch.jobId || punch.endsDay)) {
      const own = await this.closedEntryOf(punch);
      const open = own ? null : await this.findOpenEntryForOut(punch.workerId, punch.siteId);
      if (own) {
        recloseId = own.id;
        recloseNote = timeEdited ? 'clock-out time corrected on punch approval' : 'clock-out confirmed on punch approval';
      } else if (!open || open.clockInAt > punch.serverTime) {
        const reclose = await this.findReclosableEntry(punch.workerId, punch.siteId, punch.serverTime);
        if (reclose) recloseId = reclose.id;
        else {
          pairIn = await this.findPairableInPunch(punch.workerId, punch.siteId, punch.serverTime);
          if (!pairIn) {
            if (!clockInAt || isNaN(clockInAt.getTime()) || clockInAt >= punch.serverTime) throw new ClockInRequiredError();
            missedIn = true;
          }
        }
      }
    }

    const reviewed = { reviewedById: reviewer.id, reviewedByName: reviewer.name, reviewedAt: this.now(), reviewNote: reviewNote?.trim() || undefined };
    if (pairIn) {
      const approvedIn = await this.db.fieldPunch.update({ where: { id: pairIn.id }, data: { status: 'APPROVED', ...reviewed } });
      await this.applyPunchEffect(approvedIn, site);
    }
    const updated = await this.db.fieldPunch.update({
      where: { id: punch.id },
      data: { status: 'APPROVED', ...reviewed, ...(timeEdited ? { serverTime: punch.serverTime, originalTime: punch.originalTime ?? recordedTime } : {}) },
    });

    let entry;
    if (recloseId) {
      entry = await this.db.$transaction(async (tx: Db) => {
        await tx.fieldTimeEntry.update({
          where: { id: recloseId },
          data: { clockOutAt: punch.serverTime, editedById: reviewer.id, editedByName: reviewer.name, editedAt: this.now(), editNote: recloseNote, approvedById: null, approvedByName: null, approvedAt: null },
        });
        return this.computeEntry(tx, recloseId!, 'PENDING');
      });
      await this.db.fieldPunch.update({ where: { id: punch.id }, data: { timeEntryId: entry.id } });
    } else if (missedIn) {
      entry = await this.db.$transaction(async (tx: Db) => {
        const e = await tx.fieldTimeEntry.create({
          data: {
            organizationId: punch.organizationId, workerId: punch.workerId, siteId: punch.siteId, workDate: localDate(clockInAt!, site.timezone), clockInAt: clockInAt!,
            clockOutAt: punch.serverTime, status: 'PENDING', editedById: reviewer.id, editedByName: reviewer.name, editedAt: this.now(), editNote: 'missed clock-in — start time set on punch approval',
          },
        });
        return this.computeEntry(tx, e.id, 'PENDING');
      });
      await this.db.fieldPunch.update({ where: { id: punch.id }, data: { timeEntryId: entry.id } });
    } else {
      entry = await this.applyPunchEffect(updated, site);
    }
    // First approved punch from an unverified / re-verification device: trust it; the selfie becomes the photo on record.
    const prof = await this.db.fieldWorkerProfile.findUnique({ where: { workerId: punch.workerId } });
    if (prof && (!prof.deviceVerified || prof.verifyRequested) && (!punch.deviceId || punch.deviceId === prof.deviceId)) {
      await this.db.fieldWorkerProfile.update({
        where: { workerId: punch.workerId },
        data: { deviceVerified: true, verifyRequested: false, ...(punch.photoKey ? { photoKey: punch.photoKey, faceDescriptor: [] } : {}) },
      });
      if (punch.photoKey && prof.verifyRequested) {
        // An older app answered an office photo request with this selfie (photos.ts closeRequestFromPunch).
        await this.db.fieldPhotoUpdate.updateMany({
          where: { organizationId: punch.organizationId, workerId: punch.workerId, status: 'REQUESTED' },
          data: { status: 'APPROVED', photoKey: punch.photoKey, reviewedById: reviewer.id, reviewedByName: reviewer.name, reviewedAt: this.now(), submittedAt: this.now() },
        });
      }
    }
    this.events.push({ action: 'PUNCH_APPROVE', entity: 'Punch', entityId: punch.id, after: { entryId: entry?.id ?? null, timeEdited, missedIn, pairedIn: pairIn?.id ?? null } });
    return { punch: updated, entry };
  }

  async rejectPunch(punchId: string, reviewer: Reviewer, reviewNote?: string) {
    const punch = await this.db.fieldPunch.findUnique({ where: { id: punchId } });
    if (!punch) throw new Error('NOT_FOUND');
    if (punch.status !== 'FLAGGED') throw new NotFlaggedError();
    const updated = await this.db.fieldPunch.update({
      where: { id: punch.id },
      data: { status: 'REJECTED', reviewedById: reviewer.id, reviewedByName: reviewer.name, reviewedAt: this.now(), reviewNote: reviewNote?.trim() || undefined },
    });
    this.events.push({ action: 'PUNCH_REJECT', entity: 'Punch', entityId: punch.id });
    return { punch: updated };
  }
}
