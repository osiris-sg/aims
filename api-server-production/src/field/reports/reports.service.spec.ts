/** Field phase 7: reports, rules, terms, audit (siteclock reports.router / rules.router / terms.router @62b7d9d). */
import { computeFieldAccess } from '../common/field-access';
import type { FieldCtx } from '../common/field-context.service';
import { fakePrisma } from '../testing/fake-prisma';
import { dayVerdict, FieldReportsService } from './reports.service';

const ORG = 'org-1';
const ctx = (roleNames = ['Admin'], extra: Partial<FieldCtx> = {}): FieldCtx => ({ organizationId: ORG, userId: 'u', userName: 'Admin', features: {}, timezone: 'Asia/Singapore', access: computeFieldAccess({ isOsirisAdmin: false, roleNames, supervises: false }), workerId: null, supervisedSiteIds: [], supervisedWorkerIds: [], ...extra });

async function setup() {
  const db: any = fakePrisma();
  const svc = new FieldReportsService(db);
  const site = await db.fieldSite.create({ data: { organizationId: ORG, name: 'Site A' } });
  const a = await db.worker.create({ data: { organizationId: ORG, name: 'Ann' } });
  const b = await db.worker.create({ data: { organizationId: ORG, name: 'Ben' } });
  for (const [w, no] of [[a, 'E2'], [b, 'E1']] as const) {
    await db.fieldWorkerProfile.create({ data: { organizationId: ORG, workerId: w.id, tier: 'WORKER', employeeNo: no } });
    await db.fieldSiteAssignment.create({ data: { organizationId: ORG, workerId: w.id, siteId: site.id } });
  }
  const tpl = await db.fieldShiftTemplate.create({ data: { organizationId: ORG, name: 'Day', startTime: '08:00', endTime: '17:00', daysOfWeek: [1, 2, 3, 4, 5] } });
  await db.fieldShiftAssignment.create({ data: { organizationId: ORG, templateId: tpl.id, workerId: a.id, startDate: '2026-01-01' } });
  return { db, svc, site, a, b };
}

describe('field reports', () => {
  it('day verdicts read as SiteClock wrote them', () => {
    expect(dayVerdict([], true, true)).toBe('Leave');
    expect(dayVerdict([], false, true)).toBe('Absent');
    expect(dayVerdict([], false, false)).toBe('Rest');
    expect(dayVerdict([{ lateMinutes: 12, status: 'APPROVED' }], false, true)).toBe('Late 12m');
    expect(dayVerdict([{ leftEarlyMinutes: 5, status: 'AUTO_CLOSED', punches: [{ insideFence: false }] }], false, true)).toBe('Left early 5m, Missed out, Off-site');
    expect(dayVerdict([{ status: 'OPEN' }], false, true)).toBe('On clock');
    expect(dayVerdict([{ status: 'PENDING' }], false, true)).toBe('Normal');
  });

  it('attendance: sorted by employee no, totals and day cells; 1-92 days; rejected entries ignored', async () => {
    const { db, svc, site, a } = await setup();
    await db.fieldTimeEntry.create({ data: { organizationId: ORG, workerId: a.id, siteId: site.id, workDate: '2026-03-02', clockInAt: new Date(), status: 'APPROVED', regularMinutes: 480, otMinutes: 60, lateMinutes: 10 } });
    await db.fieldTimeEntry.create({ data: { organizationId: ORG, workerId: a.id, siteId: site.id, workDate: '2026-03-03', clockInAt: new Date(), status: 'REJECTED', regularMinutes: 480 } });
    const r = await svc.attendance(ctx(), { from: '2026-03-02', to: '2026-03-04' });
    expect(r.headers.slice(-3)).toEqual(['2 Mon', '3 Tue', '4 Wed']);
    expect(r.rows.map((x) => x[1])).toEqual(['Ben', 'Ann']);
    expect(r.rows[1].slice(2, 10)).toEqual(['1', '0', '0', '2', '540', '60', '1', '10']);
    expect(r.rows[1].slice(-3)).toEqual(['Late 10m', 'Absent', 'Absent']);
    expect(r.rows[0].slice(-3)).toEqual(['Rest', 'Rest', 'Rest']);
    await expect(svc.attendance(ctx(), { from: '2026-01-01', to: '2026-04-30' })).rejects.toThrow('1 to 92');
  });

  it('a supervisor sees only their site, and not another one', async () => {
    const { db, svc, site, a } = await setup();
    await db.fieldTimeEntry.create({ data: { organizationId: ORG, workerId: a.id, siteId: site.id, workDate: '2026-03-02', clockInAt: new Date(), status: 'APPROVED', regularMinutes: 480 } });
    await db.fieldPunch.create({ data: { organizationId: ORG, workerId: a.id, siteId: site.id, type: 'IN', serverTime: new Date('2026-03-02T01:00:00Z'), flagReason: 'OUTSIDE_FENCE', status: 'FLAGGED' } });
    expect((await svc.summary(ctx(), { from: '2026-03-01', to: '2026-03-31' })).summary).toHaveLength(1);
    expect((await svc.fraud(ctx(), { from: '2026-03-01', to: '2026-03-31' })).total).toBe(1);
    // Sales: a role with no HR access of its own (Viewer views every HR tab since 2026-11-24).
    const sup = ctx(['Sales'], { access: computeFieldAccess({ isOsirisAdmin: false, roleNames: ['Sales'], supervises: true }), supervisedSiteIds: ['other'], supervisedWorkerIds: [] });
    expect(sup.access.scoped.reports).toBe(true);
    expect((await svc.attendance(sup, { from: '2026-03-02', to: '2026-03-02' })).rows).toEqual([]);
    expect((await svc.summary(sup, { from: '2026-03-01', to: '2026-03-31' })).summary).toEqual([]);
    expect((await svc.fraud(sup, { from: '2026-03-01', to: '2026-03-31' })).total).toBe(0);
    await expect(svc.attendance(sup, { from: '2026-03-02', to: '2026-03-02', siteId: site.id })).rejects.toThrow('Not your site');
  });

  it('fraud summary counts flagged punches by reason, UTC days (oddity kept)', async () => {
    const { db, svc, site, a } = await setup();
    const mk = (t: string, flagReason: string | null) => db.fieldPunch.create({ data: { organizationId: ORG, workerId: a.id, siteId: site.id, type: 'IN', serverTime: new Date(t), flagReason, status: 'FLAGGED' } });
    await mk('2026-03-02T05:00:00Z', 'OUTSIDE_FENCE');
    await mk('2026-03-02T06:00:00Z', 'FACE_MISMATCH');
    await mk('2026-03-02T07:00:00Z', null);
    await mk('2026-03-01T17:00:00Z', 'OUTSIDE_FENCE'); // 2 Mar 01:00 SGT, outside the UTC day
    const f = await svc.fraud(ctx(), { from: '2026-03-02', to: '2026-03-02' });
    expect(f).toMatchObject({ total: 2, byReason: { OUTSIDE_FENCE: 1, FACE_MISMATCH: 1 }, utcDays: true });
    expect(f.topWorkers).toEqual([{ workerId: a.id, name: 'Ann', flags: 2 }]);
  });

  it('rules: SiteClock defaults made on first read, upserts per site, admin only', async () => {
    const { svc, site } = await setup();
    const r = await svc.rules(ctx());
    expect(r.overtime).toEqual([expect.objectContaining({ siteId: null, dailyThresholdMin: 528, otMultiplier: 1.5 })]);
    expect(r.breaks).toEqual([expect.objectContaining({ siteId: null, deductMinutes: 60, minShiftMinutes: 360, nlbCreditMinutes: 0 })]);
    await svc.setOvertime(ctx(), { dailyThresholdMin: 480, otMultiplier: 1.5 });
    await svc.setOvertime(ctx(), { siteId: site.id, dailyThresholdMin: 500, otMultiplier: 2 });
    const r2 = await svc.rules(ctx());
    expect(r2.overtime.map((o: any) => [o.siteId, o.dailyThresholdMin])).toEqual([[null, 480], [site.id, 500]]);
    await expect(svc.setOvertime(ctx(['Operations']), { dailyThresholdMin: 1, otMultiplier: 1.5 })).rejects.toThrow('Only an Admin');
    const p = await svc.setPunchRules(ctx(), { offSiteReview: 'BLOCK' });
    expect(p.punch.offSiteReview).toBe('BLOCK');
    await expect(svc.setPunchRules(ctx(), { jobClockingTeamIds: ['nope'] })).rejects.toThrow('Unknown team');
  });

  it('terms: a new version asks everyone again; audit merges AIMS and SiteClock history', async () => {
    const { db, svc } = await setup();
    const v = await svc.setTerms(ctx(), { text: 'x'.repeat(30) });
    expect(v.version).toBeGreaterThan(0);
    const t = await svc.terms(ctx());
    expect(t.acceptances.every((x: any) => !x.current)).toBe(true);
    await db.actionLog.create({ data: { organizationId: ORG, actorType: 'USER', actorId: 'u', actorName: 'Elroy', channel: 'portal', method: 'POST', path: '/field/people/workers', action: 'CREATE', resource: 'field', status: 'SUCCESS', statusCode: 201, details: { result: { fieldAction: 'WORKER_CREATE', entity: 'User' } }, createdAt: new Date() } });
    await db.actionLog.create({ data: { organizationId: ORG, actorType: 'USER', actorId: 'u', method: 'GET', path: '/field/people/workers', action: 'VIEW', resource: 'field', status: 'SUCCESS', statusCode: 200, createdAt: new Date() } });
    await db.fieldAuditImport.create({ data: { organizationId: ORG, siteclockId: 'a1', actorName: 'Boss', action: 'LEAVE_APPROVE', entity: 'LeaveRequest', createdAt: new Date(Date.now() - 1000) } });
    const au = await svc.audit(ctx(), {});
    expect(au.rows.map((r: any) => [r.source, r.action])).toEqual([['AIMS', 'WORKER_CREATE'], ['SiteClock', 'LEAVE_APPROVE']]);
  });
});
