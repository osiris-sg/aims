/**
 * The Field time engine against SiteClock's own expected numbers (siteclock backend/test/e2e.ts @62b7d9d; line refs
 * per test). In-memory Prisma stand-in; times in Asia/Singapore like the e2e suite.
 */
import { DateTime } from 'luxon';
import { fakePrisma, type FakePrisma } from '../testing/fake-prisma';
import { ClockInRequiredError, FieldEngine, PunchTimeInvalidError } from './engine';

const ORG = 'org-1';
const TZ = 'Asia/Singapore';
const at = (d: string, hm: string) => DateTime.fromFormat(`${d} ${hm}`, 'yyyy-MM-dd HH:mm', { zone: TZ }).toJSDate();
const MON = '2026-02-02';
const REVIEWER = { id: 'u-admin', name: 'Admin' };

async function setup(opts: { shift?: boolean; ot?: Record<string, unknown>; brk?: Record<string, unknown> } = {}) {
  const db: FakePrisma = fakePrisma();
  const site = await db.fieldSite.create({ data: { organizationId: ORG, name: 'Block', lat: 1.3, lng: 103.8, timezone: TZ } });
  const w = await db.worker.create({ data: { organizationId: ORG, name: 'Worker' } });
  await db.fieldSettings.create({ data: { organizationId: ORG } });
  // createCompanyWithDefaults: one company-wide OT rule (528 / 1.5) and break rule (60 / 360 / 0).
  await db.fieldOvertimeRule.create({ data: { organizationId: ORG, ...(opts.ot ?? {}) } });
  await db.fieldBreakRule.create({ data: { organizationId: ORG, ...(opts.brk ?? {}) } });
  if (opts.shift !== false) {
    const t = await db.fieldShiftTemplate.create({ data: { organizationId: ORG, name: 'Day 8-17', startTime: '08:00', endTime: '17:00', daysOfWeek: [1, 2, 3, 4, 5], graceLateMin: 10 } });
    await db.fieldShiftAssignment.create({ data: { organizationId: ORG, templateId: t.id, workerId: w.id, startDate: '2026-01-01' } });
  }
  const engine = new FieldEngine(db);
  const entry = async (workDate: string, inAt: Date, outAt: Date | null, extra: Record<string, unknown> = {}) =>
    db.fieldTimeEntry.create({ data: { organizationId: ORG, workerId: w.id, siteId: site.id, workDate, clockInAt: inAt, clockOutAt: outAt, status: outAt ? 'PENDING' : 'OPEN', ...extra } });
  const compute = async (id: string, s: 'PENDING' | 'AUTO_CLOSED' = 'PENDING') => engine.computeEntry(db, id, s);
  return { db, site, w, engine, entry, compute };
}

describe('computeEntry (e2e.ts 549-581)', () => {
  it('08:25-18:25 on Day 8-17: gross 600, break 60, regular 528, OT 12, late 15', async () => {
    const { entry, compute } = await setup();
    const e = await compute((await entry(MON, at(MON, '08:25'), at(MON, '18:25'))).id);
    expect(e).toMatchObject({ grossMinutes: 600, breakMinutes: 60, regularMinutes: 528, otMinutes: 12, lateMinutes: 15, otMultiplier: 1.5, status: 'PENDING' });
  });
  it('early 07:30-17:00 is paid from the shift start (clamp): gross 540, early 30, late 0', async () => {
    const { entry, compute } = await setup();
    const e = await compute((await entry('2026-01-26', at('2026-01-26', '07:30'), at('2026-01-26', '17:00'))).id);
    expect(e).toMatchObject({ grossMinutes: 540, earlyMinutes: 30, lateMinutes: 0 });
  });
  it('a day crossing midnight keeps the clock-in date: gross 480', async () => {
    const { entry, compute } = await setup({ shift: false });
    const e = await compute((await entry(MON, at(MON, '22:00'), new Date(at(MON, '22:00').getTime() + 8 * 3600_000))).id);
    expect(e).toMatchObject({ workDate: MON, grossMinutes: 480 });
  });
  it('no break below the minimum shift; no shift = no late / early', async () => {
    const { entry, compute } = await setup({ shift: false });
    const e = await compute((await entry(MON, at(MON, '09:00'), at(MON, '14:00'))).id);
    expect(e).toMatchObject({ grossMinutes: 300, breakMinutes: 0, regularMinutes: 300, otMinutes: 0, lateMinutes: 0, earlyMinutes: 0, shiftAssignmentId: null });
  });
});

describe('no-lunch-break (e2e.ts 890-908) and the NLB credit oddity', () => {
  it('credit 30: an approved NLB day deducts 30 instead of 60, and the 30 minutes are paid', async () => {
    const { entry, compute, db } = await setup({ brk: { nlbCreditMinutes: 30 } });
    const e = await entry(MON, at(MON, '08:25'), at(MON, '18:25'));
    const base = await compute(e.id);
    expect(base.breakMinutes).toBe(60);
    await db.fieldTimeEntry.update({ where: { id: e.id }, data: { nlb: true } });
    const nlb = await compute(e.id);
    expect(nlb.breakMinutes).toBe(30);
    expect(nlb.regularMinutes + nlb.otMinutes).toBe(base.regularMinutes + base.otMinutes + 30);
  });
  it('oddity kept: the default credit is 0, so an approved NLB changes nothing', async () => {
    const { entry, compute, db } = await setup();
    const e = await entry(MON, at(MON, '08:25'), at(MON, '18:25'), { nlb: true });
    expect((await compute(e.id)).breakMinutes).toBe(60);
    void db;
  });
});

describe('weekly OT cap (e2e.ts 2015-2030)', () => {
  it('50 OT minutes already this week, cap 60: the new day gets 10 OT, the rest is regular', async () => {
    const { entry, compute } = await setup({ shift: false, ot: { weeklyCapOtMin: 60 } });
    await entry('2026-02-03', at('2026-02-03', '08:00'), at('2026-02-03', '18:00'), { status: 'APPROVED', regularMinutes: 528, otMinutes: 50 });
    const e = await compute((await entry('2026-02-04', at('2026-02-04', '07:00'), at('2026-02-04', '18:00'))).id);
    expect(e.otMinutes).toBe(10);
    expect(e.regularMinutes).toBeGreaterThan(528);
  });
});

describe('early clock-in modes (e2e.ts 3030-3058)', () => {
  async function early(ot: Record<string, unknown>, tpl: Record<string, unknown> = {}) {
    const { db, w, entry, compute } = await setup({ shift: false, ot });
    const t = await db.fieldShiftTemplate.create({ data: { organizationId: ORG, name: 'Early', startTime: '10:00', endTime: '19:00', daysOfWeek: [1], graceLateMin: 10, ...tpl } });
    await db.fieldShiftAssignment.create({ data: { organizationId: ORG, templateId: t.id, workerId: w.id, startDate: '2026-01-01' } });
    // 09:00-19:00 SGT on Monday 5 Jan 2026
    return compute((await entry('2026-01-05', new Date('2026-01-05T01:00:00Z'), new Date('2026-01-05T11:00:00Z'))).id);
  }
  it('rule countEarlyAsWork on: paid from the clock-in (600); off: from the shift start (540)', async () => {
    expect((await early({ countEarlyAsWork: true })).grossMinutes).toBe(600);
    expect((await early({ countEarlyAsWork: false })).grossMinutes).toBe(540);
  });
  it('slide: paid from the clock-in and the expected end moves earlier (no left-early); template payEarly beats the rule', async () => {
    const s = await early({ countEarlyAsWork: false }, { earlyMode: 'slide' });
    expect(s).toMatchObject({ grossMinutes: 600, leftEarlyMinutes: 0 });
    expect((await early({ countEarlyAsWork: false }, { payEarly: true })).grossMinutes).toBe(600);
  });
});

describe('missed clock-out / auto-close (lib/missedClockOut.ts, e2e.ts 960-1000)', () => {
  const day = MON;
  const now = () => at('2026-02-04', '12:00');
  async function staleClose(rule: string, inAt: Date, shift = true) {
    const s = await setup({ shift });
    await s.db.fieldSettings.update({ where: { organizationId: ORG }, data: { missedClockOut: rule } });
    const e = await s.entry(day, inAt, null);
    const engine = new FieldEngine(s.db, now);
    expect(await engine.autoCloseStaleEntries(ORG)).toBe(1);
    return { e: await s.db.fieldTimeEntry.findUnique({ where: { id: e.id } }), engine, s };
  }
  it('FULL_SHIFT assumes the shift length (clock-in + 9h); no shift: + the site window (14h)', async () => {
    const { e, engine } = await staleClose('FULL_SHIFT', at(day, '08:25'));
    expect(e.status).toBe('AUTO_CLOSED');
    expect(e.clockOutAt.getTime()).toBe(at(day, '08:25').getTime() + 9 * 3600_000);
    expect(engine.events[0]).toMatchObject({ action: 'ENTRY_AUTO_CLOSE', after: { rule: 'FULL_SHIFT', basis: 'shift_length' } });
    const noShift = await staleClose('FULL_SHIFT', at(day, '08:25'), false);
    expect(noShift.e.clockOutAt.getTime()).toBe(at(day, '08:25').getTime() + 14 * 3600_000);
  });
  it('SHIFT_END: the scheduled end; clocked in after it ended: no hours', async () => {
    expect((await staleClose('SHIFT_END', at(day, '08:25'))).e.clockOutAt.getTime()).toBe(at(day, '17:00').getTime());
    const late = (await staleClose('SHIFT_END', at(day, '18:30'))).e;
    expect(late.clockOutAt.getTime()).toBe(at(day, '18:30').getTime());
    expect(late.grossMinutes).toBe(0);
  });
  it('NO_HOURS: closed at the clock-in (0), even with a shift; a day with job clockings ends at the last one', async () => {
    const { e } = await staleClose('NO_HOURS', at(day, '08:25'));
    expect(e).toMatchObject({ grossMinutes: 0 });
    expect(e.clockOutAt.getTime()).toBe(at(day, '08:25').getTime());
    const s = await setup();
    await s.db.fieldSettings.update({ where: { organizationId: ORG }, data: { missedClockOut: 'NO_HOURS' } });
    const open = await s.entry(day, at(day, '08:25'), null);
    const job = await s.db.fieldJob.create({ data: { organizationId: ORG, date: day, title: 'J', location: 'x', siteId: s.site.id } });
    await s.db.fieldPunch.create({ data: { organizationId: ORG, workerId: s.w.id, siteId: s.site.id, type: 'IN', lat: 1, lng: 1, accuracyM: 5, distanceM: 1, insideFence: true, serverTime: at(day, '13:10'), jobId: job.id, timeEntryId: open.id } });
    await new FieldEngine(s.db, now).autoCloseStaleEntries(ORG);
    expect((await s.db.fieldTimeEntry.findUnique({ where: { id: open.id } })).clockOutAt.getTime()).toBe(at(day, '13:10').getTime());
  });
  it('an entry still inside its site window is left open', async () => {
    const s = await setup();
    await s.entry(day, at('2026-02-04', '08:00'), null);
    expect(await new FieldEngine(s.db, now).autoCloseStaleEntries(ORG)).toBe(0);
  });
});

describe('paid hours follow the crew (crewSpan; e2e.ts 1640-1760)', () => {
  async function crewDay(profile: Record<string, unknown>) {
    const s = await setup({ shift: false });
    await s.db.fieldWorkerProfile.create({ data: { organizationId: ORG, workerId: s.w.id, payFollowsCrew: true, ...profile } });
    const mate = await s.db.worker.create({ data: { organizationId: ORG, name: 'Mate' } });
    const job = await s.db.fieldJob.create({ data: { organizationId: ORG, date: MON, title: 'J', location: 'x', siteId: s.site.id } });
    await s.db.fieldJobCrew.create({ data: { organizationId: ORG, jobId: job.id, workerId: s.w.id } });
    await s.db.fieldJobCrew.create({ data: { organizationId: ORG, jobId: job.id, workerId: mate.id } });
    const punch = (who: string, type: string, hm: string) =>
      s.db.fieldPunch.create({ data: { organizationId: ORG, workerId: who, siteId: s.site.id, type, lat: 1, lng: 1, accuracyM: 5, distanceM: 1, insideFence: true, serverTime: at(MON, hm), jobId: job.id } });
    return { ...s, mate, job, punch };
  }
  it('beyond the margins: paid from the crew first minus 15 to the crew last plus 30, held for review with the note', async () => {
    const s = await crewDay({});
    await s.punch(s.mate.id, 'IN', '09:00');
    await s.punch(s.mate.id, 'OUT', '16:00');
    const e = await s.compute((await s.entry(MON, at(MON, '07:00'), at(MON, '18:00'))).id);
    expect(e.paidFromAt.getTime()).toBe(at(MON, '08:45').getTime());
    expect(e.paidToAt.getTime()).toBe(at(MON, '16:30').getTime());
    expect(e.grossMinutes).toBe(465);
    expect(e.needsReview).toBe(true);
    expect(e.crewNote).toBe("Clocked in 2h  before the crew's first job clock-in; 15 min paid. Clocked out 2h  after the crew's last job clock-out; 30 min paid.".replace(/2h  /g, '2h '));
  });
  it('within the margins: paid as clocked, nothing to review; own margins override the company', async () => {
    const s = await crewDay({ crewMarginBeforeMin: 60 });
    await s.punch(s.mate.id, 'IN', '09:00');
    await s.punch(s.mate.id, 'OUT', '16:00');
    const e = await s.compute((await s.entry(MON, at(MON, '08:10'), at(MON, '16:20'))).id);
    expect(e).toMatchObject({ needsReview: false, crewNote: null, grossMinutes: 490 });
    expect(e.paidFromAt.getTime()).toBe(at(MON, '08:10').getTime());
  });
  it('an office edit is final: paid as edited, the crew fields cleared', async () => {
    const s = await crewDay({});
    await s.punch(s.mate.id, 'IN', '09:00');
    const e = await s.compute((await s.entry(MON, at(MON, '07:00'), at(MON, '07:30'), { editedById: 'u-admin' })).id);
    expect(e).toMatchObject({ needsReview: false, paidFromAt: null, crewNote: null, grossMinutes: 30 });
  });
  it('no job that day / no clockings: paid as clocked, held for review with the reason', async () => {
    const s = await setup({ shift: false });
    await s.db.fieldWorkerProfile.create({ data: { organizationId: ORG, workerId: s.w.id, payFollowsCrew: true } });
    const e = await s.compute((await s.entry(MON, at(MON, '08:00'), at(MON, '12:00'))).id);
    expect(e).toMatchObject({ needsReview: true, grossMinutes: 240, crewNote: "Not on any job's crew this day — paid as clocked. Check the hours." });
    const c = await crewDay({});
    const e2 = await c.compute((await c.entry(MON, at(MON, '08:00'), at(MON, '12:00'))).id);
    expect(e2.crewNote).toBe("No clockings on this day's jobs, by the crew or by them — paid as clocked. Check the hours.");
  });
});

describe('shared workers: workedFor (e2e.ts 3720-3735)', () => {
  it('90 of 180 minutes on a linked org\'s job are marked as that org\'s', async () => {
    const s = await setup({ shift: false });
    const other = await s.db.fieldJob.create({ data: { organizationId: 'org-2', date: MON, title: 'Partner job', location: 'y', siteId: s.site.id } });
    await s.db.fieldPunch.create({ data: { organizationId: ORG, workerId: s.w.id, siteId: s.site.id, type: 'IN', lat: 1, lng: 1, accuracyM: 5, distanceM: 1, insideFence: true, serverTime: at(MON, '10:00'), jobId: other.id } });
    await s.db.fieldPunch.create({ data: { organizationId: ORG, workerId: s.w.id, siteId: s.site.id, type: 'OUT', lat: 1, lng: 1, accuracyM: 5, distanceM: 1, insideFence: true, serverTime: at(MON, '11:30'), jobId: other.id } });
    const e = await s.compute((await s.entry(MON, at(MON, '09:00'), at(MON, '12:00'))).id);
    expect(e.grossMinutes).toBe(180);
    expect(e.workedFor).toEqual({ 'org-2': 90 });
  });
});

describe('punch review (punches.service approvePunch / rejectPunch; e2e.ts 520-530, 1030)', () => {
  const flagged = (s: any, type: 'IN' | 'OUT', when: Date, extra: Record<string, unknown> = {}) =>
    s.db.fieldPunch.create({ data: { organizationId: ORG, workerId: s.w.id, siteId: s.site.id, type, lat: 1, lng: 1, accuracyM: 5, distanceM: 900, insideFence: false, serverTime: when, status: 'FLAGGED', flagReason: 'OUTSIDE_FENCE', ...extra } });

  it('an OUT with nothing open needs the clock-in time; with it, a PENDING entry is made (gross 90)', async () => {
    const s = await setup({ shift: false });
    const p = await flagged(s, 'OUT', at(MON, '10:30'));
    await expect(s.engine.approvePunch(p.id, REVIEWER)).rejects.toBeInstanceOf(ClockInRequiredError);
    const r = await s.engine.approvePunch(p.id, REVIEWER, at(MON, '09:00'));
    expect(r.entry).toMatchObject({ grossMinutes: 90, status: 'PENDING', editedById: 'u-admin', editNote: 'missed clock-in — start time set on punch approval' });
    expect((await s.db.fieldPunch.findUnique({ where: { id: p.id } })).timeEntryId).toBe(r.entry.id);
  });
  it('approving the OUT approves its flagged IN too (one review, whole entry)', async () => {
    const s = await setup({ shift: false });
    const pin = await flagged(s, 'IN', at(MON, '08:00'));
    const pout = await flagged(s, 'OUT', at(MON, '12:00'));
    const r = await s.engine.approvePunch(pout.id, REVIEWER, undefined, 'OK, confirmed with foreman');
    expect(r.entry).toMatchObject({ grossMinutes: 240, status: 'PENDING' });
    expect((await s.db.fieldPunch.findUnique({ where: { id: pin.id } })).status).toBe('APPROVED');
    expect(r.punch).toMatchObject({ status: 'APPROVED', reviewNote: 'OK, confirmed with foreman', reviewedByName: 'Admin' });
  });
  it('an auto-closed day is re-closed at the real clock-out; a corrected time keeps the original; future times refused', async () => {
    const s = await setup({ shift: false });
    const e = await s.entry(MON, at(MON, '08:00'), at(MON, '22:00'), { status: 'AUTO_CLOSED' });
    const pout = await flagged(s, 'OUT', at(MON, '17:00'));
    await expect(s.engine.approvePunch(pout.id, REVIEWER, undefined, undefined, new Date(Date.now() + 3600_000))).rejects.toBeInstanceOf(PunchTimeInvalidError);
    const r = await s.engine.approvePunch(pout.id, REVIEWER, undefined, undefined, at(MON, '16:30'));
    expect(r.entry.id).toBe(e.id);
    expect(r.entry.clockOutAt.getTime()).toBe(at(MON, '16:30').getTime());
    expect(r.entry).toMatchObject({ status: 'PENDING', editNote: 'auto-closed entry re-closed at real clock-out on punch approval' });
    expect(r.punch.originalTime.getTime()).toBe(at(MON, '17:00').getTime());
  });
  it('an approved IN opens the day; a stale open day is closed first; reject only flagged punches', async () => {
    const s = await setup({ shift: false });
    const older = await s.entry('2026-02-01', at('2026-02-01', '08:00'), null);
    const pin = await flagged(s, 'IN', at(MON, '08:00'));
    const r = await s.engine.approvePunch(pin.id, REVIEWER);
    expect(r.entry).toMatchObject({ status: 'OPEN', workDate: MON });
    expect((await s.db.fieldTimeEntry.findUnique({ where: { id: older.id } })).status).toBe('AUTO_CLOSED');
    await expect(s.engine.rejectPunch(pin.id, REVIEWER)).rejects.toThrow('NOT_FLAGGED');
    const p2 = await flagged(s, 'IN', at(MON, '09:00'));
    expect((await s.engine.rejectPunch(p2.id, REVIEWER, 'Not on site')).punch).toMatchObject({ status: 'REJECTED', reviewNote: 'Not on site' });
  });
  it('the first approved punch from an unverified phone trusts it and keeps the selfie as the photo on record', async () => {
    const s = await setup({ shift: false });
    await s.db.fieldWorkerProfile.create({ data: { organizationId: ORG, workerId: s.w.id, deviceVerified: false, deviceId: 'dev-1', verifyRequested: true } });
    await s.db.fieldPhotoUpdate.create({ data: { organizationId: ORG, workerId: s.w.id, status: 'REQUESTED' } });
    const p = await flagged(s, 'IN', at(MON, '08:00'), { deviceId: 'dev-1', photoKey: 'selfie-1', flagReason: 'NEW_DEVICE' });
    await s.engine.approvePunch(p.id, REVIEWER);
    expect(await s.db.fieldWorkerProfile.findUnique({ where: { workerId: s.w.id } })).toMatchObject({ deviceVerified: true, verifyRequested: false, photoKey: 'selfie-1' });
    expect((await s.db.fieldPhotoUpdate.findFirst({ where: { workerId: s.w.id } })).status).toBe('APPROVED');
  });
});
