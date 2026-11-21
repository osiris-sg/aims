/** Field phase 6: payroll, SiteClock's own numbers (siteclock backend/test/e2e.ts 1871-1995 @62b7d9d). */
import { computeFieldAccess } from '../common/field-access';
import type { FieldCtx } from '../common/field-context.service';
import { fakePrisma } from '../testing/fake-prisma';
import { deriveRates, EMPTY_PROFILE } from './payroll-engine';
import { FieldPayrollService } from './payroll.service';

const ORG = 'org-1';
const ctx = (): FieldCtx => ({ organizationId: ORG, userId: 'u', userName: 'Admin', features: {}, timezone: 'Asia/Singapore', access: computeFieldAccess({ isOsirisAdmin: false, roleNames: ['Admin'], supervises: false }), workerId: null, supervisedSiteIds: [], supervisedWorkerIds: [] });

async function march() {
  const db: any = fakePrisma();
  const svc = new FieldPayrollService(db);
  const w = await db.worker.create({ data: { organizationId: ORG, name: 'E2E Worker' } });
  await db.fieldWorkerProfile.create({ data: { organizationId: ORG, workerId: w.id, tier: 'WORKER' } });
  const tpl = await db.fieldShiftTemplate.create({ data: { organizationId: ORG, name: 'Day', startTime: '08:00', endTime: '17:00', daysOfWeek: [1, 2, 3, 4, 5] } });
  await db.fieldShiftAssignment.create({ data: { organizationId: ORG, templateId: tpl.id, workerId: w.id, startDate: '2026-01-01' } });
  await svc.addHoliday(ctx(), { date: '2026-03-06', name: 'E2E Holiday' });
  const mk = (date: string, status: string, regularMinutes: number, otMinutes: number) =>
    db.fieldTimeEntry.create({ data: { organizationId: ORG, workerId: w.id, siteId: 's', workDate: date, clockInAt: new Date(`${date}T00:00:00Z`), clockOutAt: new Date(`${date}T10:00:00Z`), status, regularMinutes, otMinutes } });
  await mk('2026-03-02', 'APPROVED', 480, 120); // Monday: 2h OT
  await mk('2026-03-06', 'APPROVED', 480, 0); // public holiday
  await mk('2026-03-07', 'APPROVED', 480, 0); // Saturday: rest day (Mon-Fri template)
  await mk('2026-03-03', 'PENDING', 480, 600); // not approved: left out
  const row = async () => (await svc.month_(ctx(), '2026-03')).workers.find((x: any) => x.workerId === w.id)!;
  const set = (body: Record<string, unknown>) => svc.setProfile(ctx(), w.id, body);
  return { db, svc, w, row, set };
}

describe('payroll (SG MOM / IPA model)', () => {
  it('$650, 6-day week: OT $5.11/h, daily $25; OT pay $10.22, PH + rest day 2 x 2 x $25 = $100, net $760.22', async () => {
    const { row, set } = await march();
    const s = await set({ basicMonthlyCents: 65000, workDaysPerWeek: 6 });
    expect(s.rates).toEqual({ otRateCents: 511, dailyRateCents: 2500 });
    const r = await row();
    expect(r).toMatchObject({ otMinutes: 120, otPayCents: 1022, premiumPayCents: 10000, netCents: 76022, daysWorked: 3, hasProfile: true });
    expect(r.premiumDays.map((d: any) => [d.kind, d.date])).toEqual([['PUBLIC_HOLIDAY', '2026-03-06'], ['REST_DAY', '2026-03-07']]);
  });

  it('leave: a paid course day costs nothing, an unpaid half day docks 0.5 x $25 = $12.50', async () => {
    const { db, w, row, set } = await march();
    await set({ basicMonthlyCents: 65000, workDaysPerWeek: 6 });
    const course = await db.fieldLeaveType.create({ data: { organizationId: ORG, name: 'Course', paid: true } });
    const unpaid = await db.fieldLeaveType.create({ data: { organizationId: ORG, name: 'Unpaid Leave', paid: false } });
    await db.fieldLeaveRequest.create({ data: { organizationId: ORG, workerId: w.id, typeId: course.id, startDate: '2026-03-04', endDate: '2026-03-04', status: 'APPROVED' } });
    await db.fieldLeaveRequest.create({ data: { organizationId: ORG, workerId: w.id, typeId: unpaid.id, startDate: '2026-03-10', endDate: '2026-03-10', halfDay: true, status: 'APPROVED' } });
    const r = await row();
    expect(r.leaveDays).toEqual(expect.arrayContaining([{ type: 'Course', paid: true, days: 1 }, { type: 'Unpaid Leave', paid: false, days: 0.5 }]));
    expect(r).toMatchObject({ unpaidLeaveDeductCents: 1250, netCents: 76022 - 1250 });
  });

  it('daily $100 (off Sat + Sun): basic 3 x $100, two extra days, OT 2h x $20.45; own off days decide rest-day pay', async () => {
    const { row, set } = await march();
    const d = await set({ payType: 'DAILY', dailyRateCentsOverride: 10000, workDaysPerWeek: 6, restDays: [6, 7] });
    expect(d.rates).toEqual({ otRateCents: 2045, dailyRateCents: 10000 });
    expect(await row()).toMatchObject({ payType: 'DAILY', basicPayCents: 30000, premiumPayCents: 20000, otPayCents: 4090, netCents: 54090 });
    await set({ payType: 'DAILY', dailyRateCentsOverride: 10000, workDaysPerWeek: 6, restDays: [3] });
    const w3 = await row();
    expect(w3.premiumDays.map((x: any) => x.kind)).toEqual(['PUBLIC_HOLIDAY']);
    expect(w3.premiumPayCents).toBe(10000);
  });

  it('hourly $15: basic 24h, OT 2h x $22.50, the PH hours paid again', async () => {
    const { row, set } = await march();
    expect((await set({ payType: 'HOURLY', hourlyRateCents: 1500, restDays: [3] })).rates.otRateCents).toBe(2250);
    expect(await row()).toMatchObject({ basicPayCents: 36000, otPayCents: 4500, premiumPayCents: 12000, netCents: 52500 });
    await expect(set({ payType: 'WEEKLY' })).rejects.toThrow('Check the pay profile');
    await expect(set({ basicMonthlyCents: 65000, premiumMode: 'TRIPLE' })).rejects.toThrow('Check the pay profile');
  });

  it('flexi (PH / off-day hours at the OT rate) and fixed hourly with no weekday OT', async () => {
    const { row, set } = await march();
    await set({ basicMonthlyCents: 65000, workDaysPerWeek: 6, restDays: [6, 7], premiumMode: 'OT_RATE' });
    expect(await row()).toMatchObject({ otPayCents: 1022, otPaidMinutes: 120, premiumMinutes: 960, premiumHourlyRateCents: 511, premiumPayCents: 8176, basicPayCents: 65000, netCents: 74198 });
    await set({ basicMonthlyCents: 65000, workDaysPerWeek: 6, restDays: [6, 7], premiumMode: 'FIXED_HOURLY', premiumRateCents: 1000, weekdayOt: false });
    expect(await row()).toMatchObject({ otMinutes: 120, otPaidMinutes: 0, otPayCents: 0, premiumMinutes: 960, premiumHourlyRateCents: 1000, premiumPayCents: 16000, netCents: 81000 });
    await set({ payType: 'DAILY', dailyRateCentsOverride: 10000, workDaysPerWeek: 6, restDays: [6, 7], premiumMode: 'OT_RATE' });
    expect(await row()).toMatchObject({ basicPayCents: 10000, otPayCents: 4090, premiumPayCents: 32720, netCents: 46810 });
  });

  it('the export names the premium basis; back to monthly resets the defaults', async () => {
    const { svc, row, set } = await march();
    await set({ payType: 'DAILY', dailyRateCentsOverride: 10000, workDaysPerWeek: 6, restDays: [6, 7], premiumMode: 'OT_RATE' });
    const ex = await svc.exportRows(ctx(), '2026-03');
    expect(ex.headers).toContain('PH/Rest Pay Basis');
    expect(ex.rows[0]).toContain('hours × OT rate $20.45/h');
    const back = await set({ basicMonthlyCents: 65000, workDaysPerWeek: 6 });
    expect(back.profile).toMatchObject({ payType: 'MONTHLY', restDays: [], premiumMode: 'DOUBLE_DAY', weekdayOt: true });
    void row;
  });

  it('oddities kept: admins left out (and listed); no profile = all zero', async () => {
    const { db, svc } = await march();
    const adm = await db.worker.create({ data: { organizationId: ORG, name: 'Admin Person' } });
    await db.fieldWorkerProfile.create({ data: { organizationId: ORG, workerId: adm.id, tier: 'COMPANY_ADMIN' } });
    const out = await svc.month_(ctx(), '2026-03');
    expect(out.leftOut.map((x: any) => x.name)).toEqual(['Admin Person']);
    expect(out.workers.find((x: any) => x.name === 'E2E Worker')!.hasProfile).toBe(false);
    expect(deriveRates(EMPTY_PROFILE)).toEqual({ otRateCents: 0, dailyRateCents: 0 });
  });
});
