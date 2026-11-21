/**
 * Field phase 2: jobs + scheduling. Cases ported from siteclock backend/test/e2e.ts @62b7d9d (line refs per test),
 * on the in-memory Prisma stand-in; the geocoder is swapped for a fixed one (as setJobGeocoder in SiteClock's tests).
 */
import { computeFieldAccess } from '../common/field-access';
import type { FieldCtx } from '../common/field-context.service';
import { fakePrisma, type FakePrisma } from '../testing/fake-prisma';
import { fmtTime, jobClockingOf, jobStatus, matchShift, resolveCrew, setJobGeocoder, visitFor, workerClocking } from './jobs-lib';
import { FieldJobsService, jobWhen } from './jobs.service';
import { assignmentsOverlap, FieldSchedulesService, rosterStatus } from './schedules.service';

const ORG = 'org-1';
const ctx = (over: Partial<FieldCtx> = {}): FieldCtx => ({
  organizationId: ORG, userId: 'u', userName: 'Admin', features: {}, timezone: 'Asia/Singapore',
  access: computeFieldAccess({ isOsirisAdmin: false, roleNames: ['Admin'], supervises: false }), workerId: null, supervisedSiteIds: [], supervisedWorkerIds: [], ...over,
});

async function setup() {
  const db: FakePrisma = fakePrisma();
  const mkW = async (name: string, active = true) => db.worker.create({ data: { organizationId: ORG, name, active } });
  const team = await db.workerTeam.create({ data: { organizationId: ORG, name: 'Team J' } });
  const [w1, w2, w3, w4] = [await mkW('W1'), await mkW('W2'), await mkW('W3'), await mkW('W4')];
  for (const w of [w1, w2, w3]) await db.fieldTeamStint.create({ data: { organizationId: ORG, teamId: team.id, workerId: w.id, startDate: '2026-01-01' } });
  return { db, team, w1, w2, w3, w4 };
}

describe('crew (lib/jobs.ts resolveCrew; e2e.ts 2606-2611, 2965-2977)', () => {
  it('team as on the date, minus the left-out, plus named workers; naming overrides leaving out; inactive left out', async () => {
    const { db, team, w1, w2, w3, w4 } = await setup();
    const crew = await resolveCrew(db, ORG, '2026-02-01', [team.id], [w4.id], [w2.id]);
    expect(crew.map((c) => c.workerId).sort()).toEqual([w1.id, w3.id, w4.id].sort());
    expect(crew.find((c) => c.workerId === w4.id)!.teamId).toBeNull();
    expect((await resolveCrew(db, ORG, '2026-02-01', [team.id], [w2.id], [w2.id])).some((c) => c.workerId === w2.id)).toBe(true);
    await db.worker.update({ where: { id: w3.id }, data: { active: false } });
    expect((await resolveCrew(db, ORG, '2026-02-01', [team.id], [])).map((c) => c.workerId)).not.toContain(w3.id);
    expect(await resolveCrew(db, ORG, '2025-12-31', [team.id], [])).toEqual([]); // before the team existed
  });
});

describe('visits, status, clocking (lib/jobs.ts)', () => {
  const t = (h: number) => new Date(`2026-02-01T${String(h).padStart(2, '0')}:00:00Z`);
  it('first arrival, last departure; rejected punches never count; status follows the crew', () => {
    const punches = [
      { workerId: 'a', type: 'IN' as const, serverTime: t(1), status: 'OK', insideFence: true, distanceM: 10.4 },
      { workerId: 'a', type: 'OUT' as const, serverTime: t(3), status: 'REJECTED', insideFence: true, distanceM: 5 },
      { workerId: 'a', type: 'OUT' as const, serverTime: t(4), status: 'OK', insideFence: false, distanceM: 300, autoLeft: true },
      { workerId: 'b', type: 'IN' as const, serverTime: t(2), status: 'FLAGGED', insideFence: false, distanceM: 900 },
    ];
    const va = visitFor(punches, 'a');
    expect(va.arrived).toMatchObject({ distanceM: 10, inside: true });
    expect(va.left).toMatchObject({ auto: true, inside: true }); // an auto-leave counts as inside
    expect(va.onJobMinutes).toBe(180);
    expect(visitFor(punches, 'b').arrived!.pending).toBe(true);
    expect(jobStatus([{ workerId: 'a' }, { workerId: 'c' }], punches)).toBe('DONE');
    expect(jobStatus([{ workerId: 'a' }, { workerId: 'b' }], punches)).toBe('IN_PROGRESS');
    expect(jobStatus([{ workerId: 'c' }], punches)).toBe('NOT_STARTED');
  });
  it('job clocking: the worker\'s own setting wins, else the job, else the rule (OFF outside its teams)', async () => {
    const { db, team, w1, w4 } = await setup();
    await db.fieldSettings.create({ data: { organizationId: ORG, jobClocking: 'ARRIVE_LEAVE', jobClockingTeamIds: [team.id] } });
    expect(await workerClocking(db, ORG, w1.id, '2026-02-01')).toEqual({ rule: 'ARRIVE_LEAVE', perWorker: false });
    expect(await workerClocking(db, ORG, w4.id, '2026-02-01')).toEqual({ rule: 'OFF', perWorker: false });
    await db.fieldWorkerProfile.create({ data: { organizationId: ORG, workerId: w4.id, jobClocking: 'ARRIVE' } });
    const own = await workerClocking(db, ORG, w4.id, '2026-02-01');
    expect(jobClockingOf({ clocking: 'OFF' }, own)).toBe('ARRIVE');
    expect(jobClockingOf({ clocking: 'OFF' }, { rule: 'ARRIVE_LEAVE', perWorker: false })).toBe('OFF');
    expect(jobClockingOf({ clocking: null }, { rule: 'ARRIVE_LEAVE', perWorker: false })).toBe('ARRIVE_LEAVE');
    expect([fmtTime('09:00'), fmtTime('20:30'), fmtTime(null)]).toEqual(['9am', '8:30pm', '']);
  });
});

describe('working hours (matchShift, e2e.ts 2995-3016; siteRoster)', () => {
  it('a site-specific template wins over a company-wide one on the same day; weekday must match', async () => {
    const db: FakePrisma = fakePrisma();
    const [sa, sb] = ['site-a', 'site-b'];
    const wide = await db.fieldShiftTemplate.create({ data: { organizationId: ORG, name: 'Wide', startTime: '08:00', endTime: '17:00', daysOfWeek: [1, 2, 3, 4, 5], siteIds: [] } });
    const atA = await db.fieldShiftTemplate.create({ data: { organizationId: ORG, name: 'Site A', startTime: '07:00', endTime: '16:00', daysOfWeek: [1, 2, 3, 4, 5], siteIds: [sa] } });
    await db.fieldShiftAssignment.create({ data: { organizationId: ORG, templateId: wide.id, workerId: 'mu', startDate: '2026-01-01' } });
    await db.fieldShiftAssignment.create({ data: { organizationId: ORG, templateId: atA.id, workerId: 'mu', startDate: '2026-01-01' } });
    expect((await matchShift(db, ORG, 'mu', sa, '2026-02-02'))!.template.name).toBe('Site A'); // Monday
    expect((await matchShift(db, ORG, 'mu', sb, '2026-02-02'))!.template.name).toBe('Wide');
    expect(await matchShift(db, ORG, 'mu', sa, '2026-02-01')).toBeNull(); // Sunday
  });
  it('roster verdicts and the overlap warning (no overlap check, as SiteClock)', () => {
    expect(rosterStatus(null, true)).toBe('ON_LEAVE');
    expect(rosterStatus(null, false)).toBe('ABSENT');
    expect(rosterStatus({ status: 'OPEN' }, false)).toBe('PRESENT');
    expect(rosterStatus({ status: 'PENDING', lateMinutes: 5 }, false)).toBe('LATE');
    expect(rosterStatus({ status: 'APPROVED', leftEarlyMinutes: 10 }, false)).toBe('LEFT_EARLY');
    expect(rosterStatus({ status: 'APPROVED' }, false)).toBe('ON_TIME');
    expect(assignmentsOverlap({ startDate: '2026-01-01', endDate: null }, { startDate: '2026-03-01', endDate: '2026-03-31' })).toBe(true);
    expect(assignmentsOverlap({ startDate: '2026-01-01', endDate: '2026-01-31' }, { startDate: '2026-03-01', endDate: null })).toBe(false);
  });
  it('exceptions: expected = assigned to the site, template covers it, not exempt; with the day\'s entries and leave', async () => {
    const db: FakePrisma = fakePrisma();
    const svc = new FieldSchedulesService(db as any);
    const site = await db.fieldSite.create({ data: { organizationId: ORG, name: 'Yard', lat: 1.3, lng: 103.8 } });
    const ws = await Promise.all(['Late', 'Leave', 'Absent', 'Exempt'].map((n) => db.worker.create({ data: { organizationId: ORG, name: n } })));
    const tpl = (await svc.createTemplate(ctx(), { name: 'Day', startTime: '08:00', endTime: '17:00', daysOfWeek: [1], siteIds: [site.id] })).template;
    for (const w of ws) {
      await db.fieldSiteAssignment.create({ data: { organizationId: ORG, siteId: site.id, workerId: w.id } });
      await svc.assign(ctx(), { templateId: tpl.id, workerId: w.id, startDate: '2026-01-01' });
    }
    await db.fieldWorkerProfile.create({ data: { organizationId: ORG, workerId: ws[3].id, attendanceExempt: true } });
    await db.fieldTimeEntry.create({ data: { organizationId: ORG, workerId: ws[0].id, siteId: site.id, workDate: '2026-02-02', clockInAt: new Date('2026-02-02T00:20:00Z'), status: 'PENDING', lateMinutes: 20 } });
    await db.fieldLeaveRequest.create({ data: { organizationId: ORG, workerId: ws[1].id, typeId: 't', startDate: '2026-02-02', endDate: '2026-02-02', status: 'APPROVED' } });
    const r = (await svc.exceptions(ctx(), site.id, '2026-02-02')).roster;
    expect(Object.fromEntries(r.map((x: any) => [x.name, x.status]))).toEqual({ Late: 'LATE', Leave: 'ON_LEAVE', Absent: 'ABSENT' });
    await svc.assign(ctx(), { templateId: tpl.id, workerId: ws[0].id, startDate: '2026-02-01' }); // overlapping: allowed (oddity)
    expect((await svc.assignments(ctx())).assignments.filter((a: any) => a.overlaps)).toHaveLength(2);
  });
});

describe('Field settings on calendar jobs (jobs.ts createJob / updateJob)', () => {
  beforeAll(() => setJobGeocoder(async (q) => (/nowhere/i.test(q) ? null : { label: `${q}, Singapore`, lat: 1.4, lng: 103.8 })));

  async function withJob() {
    const s = await setup();
    const cust = await s.db.customer.create({ data: { organizationId: ORG, name: 'Ajiya Okonomiyaki' } });
    const job = await s.db.delivery.create({ data: { organizationId: ORG, deliveryNumber: 7, status: 'scheduled', isDraft: false, scheduledFor: new Date('2026-02-02T01:30:00Z'), scheduledAllDay: false, customerId: cust.id, siteAddress: '210 Hougang St 21' } });
    return { ...s, job, svc: new FieldJobsService(s.db as any) };
  }

  it('first save makes the FieldJob: place geocoded into a JOB site (200 m fence), crew from the teams on the date, a QR code', async () => {
    const { db, svc, job, team, w2, w4 } = await withJob();
    const out = await svc.saveJob(ctx(), { deliveryId: job.id, teamIds: [team.id], exceptWorkerIds: [w2.id], workerIds: [w4.id], qrRequired: true, clocking: 'ARRIVE' });
    expect(out.created).toBe(true);
    expect(out.job).toMatchObject({ date: '2026-02-02', startTime: '09:30', title: 'Ajiya Okonomiyaki', location: '210 Hougang St 21', clocking: 'ARRIVE', qrRequired: true });
    expect(out.job.qrToken).toHaveLength(24);
    const site = await db.fieldSite.findUnique({ where: { id: out.job.siteId } });
    expect(site).toMatchObject({ kind: 'JOB', radiusM: 200, maxAccuracyM: 100 });
    expect((await db.fieldJobCrew.findMany({ where: { jobId: out.job.id } })).length).toBe(3);
    // a second job nearby reuses the JOB place
    const job2 = await db.delivery.create({ data: { organizationId: ORG, deliveryNumber: 8, status: 'scheduled', isDraft: false, scheduledFor: new Date('2026-02-02T05:00:00Z'), siteAddress: '210 Hougang St 21' } });
    expect((await svc.saveJob(ctx(), { deliveryId: job2.id, location: '210 Hougang St 21' })).job.siteId).toBe(out.job.siteId);
  });

  it('an address that cannot be found is refused (422); a named site is used as is', async () => {
    const { db, svc, job } = await withJob();
    await expect(svc.saveJob(ctx(), { deliveryId: job.id, location: 'Nowhere Lane' })).rejects.toMatchObject({ response: { code: 'PLACE_NOT_FOUND' } });
    const yard = await db.fieldSite.create({ data: { organizationId: ORG, name: 'Warehouse', lat: 1.3, lng: 103.7 } });
    expect((await svc.saveJob(ctx(), { deliveryId: job.id, location: 'warehouse' })).job.siteId).toBe(yard.id);
  });

  it('notify marks the crew told; moving the job clears it so they are told again (e2e.ts 2885)', async () => {
    const { db, svc, job, team } = await withJob();
    const { job: fj } = await svc.saveJob(ctx(), { deliveryId: job.id, teamIds: [team.id], location: 'Hougang' });
    expect(await svc.notify(ctx(), { date: '2026-02-02' })).toMatchObject({ workers: 3, told: 0, marked: 3 });
    expect(await svc.notify(ctx(), { date: '2026-02-02' })).toMatchObject({ marked: 0 });
    await db.delivery.update({ where: { id: job.id }, data: { scheduledFor: new Date('2026-02-02T03:00:00Z') } });
    await svc.saveJob(ctx(), { deliveryId: job.id });
    expect((await db.fieldJobCrew.findMany({ where: { jobId: fj.id } })).every((c: any) => c.notifiedAt === null)).toBe(true);
  });

  it('the day plan lists calendar jobs with their planned crew before any Field settings, then the saved ones', async () => {
    const { svc, job, team } = await withJob();
    const plan = await svc.day(ctx(), '2026-02-02');
    expect(plan.jobs).toHaveLength(1);
    expect(plan.jobs[0]).toMatchObject({ deliveryId: job.id, settingsSaved: false, startTime: '09:30', title: 'Ajiya Okonomiyaki', crew: [] });
    await svc.saveJob(ctx(), { deliveryId: job.id, teamIds: [team.id], location: 'Hougang' });
    const after = await svc.day(ctx(), '2026-02-02');
    expect(after.jobs[0].settingsSaved).toBe(true);
    expect(after.jobs[0].crew.map((c: any) => c.name)).toEqual(['W1', 'W2', 'W3']);
    expect(jobWhen(new Date('2026-02-01T16:00:00Z'), true, 'Asia/Singapore')).toEqual({ date: '2026-02-02', startTime: null });
  });
});
