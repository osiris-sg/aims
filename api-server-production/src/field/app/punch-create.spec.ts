/**
 * Clock in / out from the AIMS app (punch-create.ts) against the rules of siteclock punches.service createPunch
 * @62b7d9d. In-memory Prisma stand-in; times in Asia/Singapore.
 */
import { DateTime } from 'luxon';
import { fakePrisma, type FakePrisma } from '../testing/fake-prisma';
import { PunchBlockedError, SelfieRequiredError, createPunch, type PunchInput } from './punch-create';

const ORG = 'org-1';
const TZ = 'Asia/Singapore';
const DAY = '2026-02-02';
const at = (hm: string, d = DAY) => DateTime.fromFormat(`${d} ${hm}`, 'yyyy-MM-dd HH:mm', { zone: TZ }).toJSDate();
// 1.3000, 103.8000 is the site; ~1.1 km north is outside its 150 m fence.
const HERE = { lat: 1.3, lng: 103.8, accuracyM: 10 };
const FAR = { lat: 1.31, lng: 103.8, accuracyM: 10 };

async function setup(opts: { settings?: Record<string, unknown>; profile?: Record<string, unknown>; assigned?: boolean } = {}) {
  const db: FakePrisma = fakePrisma();
  const site = await db.fieldSite.create({ data: { organizationId: ORG, name: 'Block', lat: 1.3, lng: 103.8, timezone: TZ } });
  const worker = await db.worker.create({ data: { organizationId: ORG, name: 'Worker' } });
  const settings = await db.fieldSettings.create({ data: { organizationId: ORG, ...(opts.settings ?? {}) } });
  await db.fieldOvertimeRule.create({ data: { organizationId: ORG } });
  await db.fieldBreakRule.create({ data: { organizationId: ORG } });
  const profile = await db.fieldWorkerProfile.create({ data: { organizationId: ORG, workerId: worker.id, deviceId: 'phone-1', ...(opts.profile ?? {}) } });
  if (opts.assigned !== false) await db.fieldSiteAssignment.create({ data: { organizationId: ORG, siteId: site.id, workerId: worker.id } });
  const actor = { worker, profile, settings };
  const punch = (type: 'IN' | 'OUT', hm: string, extra: Partial<PunchInput> = {}) =>
    createPunch(db, actor, { siteId: site.id, type, ...HERE, deviceId: 'phone-1', ...extra }, () => at(hm));
  return { db, site, worker, actor, punch };
}

describe('createPunch: the plain day', () => {
  it('IN inside the fence opens the day; OUT closes it and computes the hours', async () => {
    const { db, punch } = await setup();
    const a: any = await punch('IN', '08:00');
    expect(a.punch).toMatchObject({ status: 'OK', flagReason: null, insideFence: true });
    expect(a.entry).toMatchObject({ status: 'OPEN', workDate: DAY });
    const b: any = await punch('OUT', '17:00');
    expect(b.entry).toMatchObject({ status: 'PENDING', grossMinutes: 540, breakMinutes: 60, regularMinutes: 480, otMinutes: 0 });
    expect(await db.fieldPunch.count({})).toBe(2);
  });

  it('the same idempotency key is stored once', async () => {
    const { db, punch } = await setup();
    await punch('IN', '08:00', { idempotencyKey: 'k1' });
    const again: any = await punch('IN', '08:01', { idempotencyKey: 'k1' });
    expect(again.duplicate).toBe(true);
    expect(await db.fieldPunch.count({})).toBe(1);
  });

  it('a punch queued offline takes effect at the time it was made; over an hour late it is flagged OFFLINE', async () => {
    const { punch } = await setup();
    const a: any = await punch('IN', '08:30', { queuedAt: at('08:00').toISOString() });
    expect(a.punch.serverTime).toEqual(at('08:00'));
    expect(a.punch).toMatchObject({ offlineSynced: true, status: 'OK' });
    const b: any = await punch('OUT', '19:30', { queuedAt: at('17:00').toISOString() });
    expect(b).toMatchObject({ flagged: true });
    expect(b.punch).toMatchObject({ status: 'FLAGGED', flagReason: 'OFFLINE' });
  });
});

describe('createPunch: where the punch was made', () => {
  it('outside the fence needs a selfie, then goes to review with no timesheet effect', async () => {
    const { db, punch } = await setup();
    await expect(punch('IN', '08:00', FAR)).rejects.toBeInstanceOf(SelfieRequiredError);
    const r: any = await punch('IN', '08:00', { ...FAR, photoKey: 'field/org-1/punches/a.jpg' });
    expect(r.flagged).toBe(true);
    expect(r.punch).toMatchObject({ status: 'FLAGGED', flagReason: 'OUTSIDE_FENCE', insideFence: false });
    expect(await db.fieldTimeEntry.count({})).toBe(0);
  });

  it('Rules > Off-site "not allowed" refuses it with a sentence for the worker', async () => {
    const { punch } = await setup({ settings: { offSiteReview: 'BLOCK' } });
    const e: any = await punch('IN', '08:00', { ...FAR, photoKey: 'k' }).catch((x) => x);
    expect(e).toBeInstanceOf(PunchBlockedError);
    expect(e.reason).toBe('OUTSIDE_FENCE');
    expect(e.userMessage).toMatch(/^You must be at Block \(within 150 m\) to clock in\. You are 1\.1 km away\.$/);
  });

  it('Rules > Off-site "just mark" records it at once and keeps the reason', async () => {
    const { punch } = await setup({ settings: { offSiteReview: 'MARK' } });
    const r: any = await punch('IN', '08:00', { ...FAR, photoKey: 'k' });
    expect(r.marked).toBe(true);
    expect(r.punch).toMatchObject({ status: 'OK', flagReason: 'OUTSIDE_FENCE' });
    expect(r.entry).toMatchObject({ status: 'OPEN' });
  });

  it('a poor GPS fix inside the fence is flagged POOR_ACCURACY', async () => {
    const { punch } = await setup();
    const r: any = await punch('IN', '08:00', { accuracyM: 80, photoKey: 'k' });
    expect(r.punch).toMatchObject({ status: 'FLAGGED', flagReason: 'POOR_ACCURACY', insideFence: true });
  });

  it('a site the worker is not assigned to needs a selfie and is flagged NOT_ASSIGNED', async () => {
    const { punch } = await setup({ assigned: false });
    await expect(punch('IN', '08:00')).rejects.toMatchObject({ reason: 'NOT_ASSIGNED' });
    const r: any = await punch('IN', '08:00', { photoKey: 'k' });
    expect(r.punch).toMatchObject({ status: 'FLAGGED', flagReason: 'NOT_ASSIGNED' });
  });

  it("another org's site is refused unless the orgs are linked and the worker has a job there", async () => {
    const { db, punch, worker } = await setup();
    const other = await db.fieldSite.create({ data: { organizationId: 'org-2', name: 'Their place', lat: 1.3, lng: 103.8, timezone: TZ, kind: 'JOB' } });
    await expect(punch('IN', '08:00', { siteId: other.id })).rejects.toMatchObject({ reason: 'SITE_NOT_FOUND' });
    await db.fieldOrgLink.create({ data: { orgAId: ORG, orgBId: 'org-2' } });
    await expect(punch('IN', '08:00', { siteId: other.id })).rejects.toMatchObject({ reason: 'SITE_NOT_FOUND' });
    const job = await db.fieldJob.create({ data: { organizationId: 'org-2', date: DAY, title: 'Install', location: 'Their place', siteId: other.id } });
    await db.fieldJobCrew.create({ data: { organizationId: 'org-2', jobId: job.id, workerId: worker.id } });
    const r: any = await punch('IN', '08:00', { siteId: other.id });
    expect(r.punch).toMatchObject({ status: 'OK', organizationId: ORG, siteId: other.id });
  });
});

describe('createPunch: the phone and the order of punches', () => {
  it('a phone that is not verified yet needs a selfie and a review (NEW_DEVICE)', async () => {
    const { punch } = await setup({ profile: { deviceVerified: false } });
    await expect(punch('IN', '08:00')).rejects.toMatchObject({ reason: 'NEW_DEVICE' });
    const r: any = await punch('IN', '08:00', { photoKey: 'k' });
    expect(r.punch).toMatchObject({ status: 'FLAGGED', flagReason: 'NEW_DEVICE' });
  });

  it('Rules > Selfie "always" asks for one on every punch', async () => {
    const { punch } = await setup({ settings: { selfiePolicy: 'ALWAYS' } });
    await expect(punch('IN', '08:00')).rejects.toMatchObject({ reason: 'POLICY' });
    const r: any = await punch('IN', '08:00', { photoKey: 'k' });
    expect(r.punch.status).toBe('OK');
  });

  it('a mocked location is flagged, or refused when the fraud rule is BLOCK', async () => {
    const a = await setup();
    const r: any = await a.punch('IN', '08:00', { mocked: true });
    expect(r.punch).toMatchObject({ status: 'FLAGGED', flagReason: 'MOCKED' });
    const b = await setup({ settings: { fraudPolicy: 'BLOCK' } });
    await expect(b.punch('IN', '08:00', { mocked: true })).rejects.toMatchObject({ reason: 'MOCKED_LOCATION' });
  });

  it('a phone clock more than 5 minutes off is flagged TIME_DRIFT', async () => {
    const { punch } = await setup();
    const r: any = await punch('IN', '08:00', { deviceTime: at('08:10').toISOString() });
    expect(r.punch).toMatchObject({ status: 'FLAGGED', flagReason: 'TIME_DRIFT' });
  });

  it('OUT with nothing open is flagged OUT_WITHOUT_IN, and a second one is refused while it waits', async () => {
    const { punch } = await setup();
    const r: any = await punch('OUT', '17:00');
    expect(r.punch).toMatchObject({ status: 'FLAGGED', flagReason: 'OUT_WITHOUT_IN' });
    await expect(punch('OUT', '17:05')).rejects.toMatchObject({ reason: 'ALREADY_PENDING' });
  });

  it('a base is refused when the rule says workers do not clock at bases', async () => {
    const { db, punch } = await setup({ settings: { baseClocking: false } });
    const base = await db.fieldSite.create({ data: { organizationId: ORG, name: 'Yard', lat: 1.3, lng: 103.8, timezone: TZ, kind: 'BASE' } });
    await expect(punch('IN', '08:00', { siteId: base.id })).rejects.toMatchObject({ reason: 'BASE_NOT_ALLOWED' });
  });
});

describe('createPunch: jobs', () => {
  async function withJob(job: Record<string, unknown> = {}) {
    const s = await setup({ assigned: false });
    const place = await s.db.fieldSite.create({ data: { organizationId: ORG, name: 'Mall', lat: 1.4, lng: 103.9, timezone: TZ, kind: 'JOB', radiusM: 200, maxAccuracyM: 100 } });
    const j = await s.db.fieldJob.create({ data: { organizationId: ORG, date: DAY, title: 'Install', location: 'Mall', siteId: place.id, ...job } });
    await s.db.fieldJobCrew.create({ data: { organizationId: ORG, jobId: j.id, workerId: s.worker.id } });
    const AT_JOB = { lat: 1.4, lng: 103.9, accuracyM: 10 };
    return { ...s, place, job: j, AT_JOB };
  }

  it('a job punch is pinned to the job place, opens the day, and counts as assigned', async () => {
    const { punch, job, place, AT_JOB } = await withJob();
    const r: any = await punch('IN', '08:00', { ...AT_JOB, jobId: job.id });
    expect(r.punch).toMatchObject({ status: 'OK', jobId: job.id, siteId: place.id });
    expect(r.entry).toMatchObject({ status: 'OPEN', siteId: place.id });
  });

  it("a job on another day, or one the worker is not on, is refused", async () => {
    const { db, punch, AT_JOB, place } = await withJob();
    const later = await db.fieldJob.create({ data: { organizationId: ORG, date: '2026-02-10', title: 'Later', location: 'Mall', siteId: place.id } });
    await expect(punch('IN', '08:00', { ...AT_JOB, jobId: later.id })).rejects.toMatchObject({ reason: 'JOB_NOT_FOUND' });
    await db.fieldJobCrew.create({ data: { organizationId: ORG, jobId: later.id, workerId: (await db.worker.findFirst({})).id } });
    await expect(punch('IN', '08:00', { ...AT_JOB, jobId: later.id })).rejects.toMatchObject({ reason: 'JOB_NOT_TODAY' });
  });

  it('QR sign-in: the wrong code is refused, no scan needs a selfie and a review, the right code passes', async () => {
    const { punch, job, AT_JOB } = await withJob({ qrRequired: true, qrToken: 'good' });
    await expect(punch('IN', '08:00', { ...AT_JOB, jobId: job.id, qrToken: 'bad' })).rejects.toMatchObject({ reason: 'QR_WRONG' });
    await expect(punch('IN', '08:00', { ...AT_JOB, jobId: job.id })).rejects.toMatchObject({ reason: 'QR_MISSING' });
    const ok: any = await punch('IN', '08:00', { ...AT_JOB, jobId: job.id, qrToken: 'good' });
    expect(ok.punch).toMatchObject({ status: 'OK', qrScanned: true });
  });

  it('a punch made for a crew member by the recorder skips the selfie and the device checks', async () => {
    const { db, punch, job, AT_JOB } = await withJob();
    const r: any = await punch('IN', '08:00', { ...AT_JOB, jobId: job.id, deviceId: undefined, recordedByWorkerId: 'w-leader' });
    expect(r.punch).toMatchObject({ status: 'OK', recordedByWorkerId: 'w-leader' });
    expect(await db.fieldTimeEntry.count({})).toBe(1);
  });
});
