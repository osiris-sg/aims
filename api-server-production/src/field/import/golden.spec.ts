import { compareGolden } from './golden';

describe('golden comparison (payroll + leave balances)', () => {
  const rows = () => ({
    worker: [{ id: 'W1', organizationId: 'o', name: 'Ann', active: true, siteclockId: 'u1' }],
    fieldWorkerProfile: [{ id: 'p', organizationId: 'o', workerId: 'W1', tier: 'WORKER', payslipVisible: false }],
    fieldPayProfile: [{ id: 'pp', organizationId: 'o', workerId: 'W1', payType: 'MONTHLY', basicMonthlyCents: 65000, workDaysPerWeek: 6, restDays: [], premiumMode: 'DOUBLE_DAY', weekdayOt: true, hourlyRateCents: 0, premiumRateCents: 0, fixedAllowanceCents: 0, deductHousingCents: 0, deductOtherCents: 0, otRateCentsOverride: null, dailyRateCentsOverride: null }],
    fieldTimeEntry: [{ id: 'e', organizationId: 'o', workerId: 'W1', workDate: '2026-03-02', status: 'APPROVED', regularMinutes: 480, otMinutes: 120, otMultiplier: 1.5 }],
    fieldPublicHoliday: [], fieldShiftAssignment: [], fieldShiftTemplate: [],
    fieldLeaveRequest: [], fieldLeaveEntitlement: [{ id: 'en', organizationId: 'o', workerId: 'W1', typeId: 'LT', days: 18 }],
    fieldLeaveType: [{ id: 'LT', organizationId: 'o', siteclockId: 'lt', name: 'Annual', paid: true, defaultDays: 14, archived: false }],
  });
  it('equal numbers: no difference; a differing number is listed with both values', async () => {
    const sc = {
      payroll: { '2026-03': [{ userId: 'u1', name: 'Ann', payType: 'MONTHLY', otRateCents: 511, dailyRateCents: 2500, basicPayCents: 65000, daysWorked: 1, regularMinutes: 480, otMinutes: 120, otPaidMinutes: 120, otPayCents: 1022, premiumMinutes: 0, premiumPayCents: 0, unpaidLeaveDeductCents: 0, grossCents: 66022, deductionCents: 0, netCents: 66022, premiumDays: [], leaveDays: [] }] },
      leave: { '2026': { u1: [{ typeId: 'lt', name: 'Annual', entitled: 18, taken: 0, pending: 0, remaining: 18, custom: true }] } },
    };
    const ok = await compareGolden(rows(), 'o', sc);
    expect(ok.diffs).toEqual([]);
    expect(ok.checked).toEqual({ payrollRows: 1, balances: 1 });
    sc.payroll['2026-03'][0].netCents = 66000;
    sc.leave['2026'].u1[0].entitled = 14;
    const bad = await compareGolden(rows(), 'o', sc);
    expect(bad.diffs.map((d) => [d.kind, d.field, d.siteclock, d.aims])).toEqual([
      ['payroll', 'netCents', 66000, 66022],
      ['leave', 'Annual entitled', 14, 18],
    ]);
  });
});
