import { planLeavePay } from './leave-pay-plan';

describe('SiteClock shadow import, leave and payroll slices', () => {
  it('types, entitlements, requests (with who decided), pay profiles, holidays, audit history', () => {
    const plan = planLeavePay(
      {
        leaveTypes: [{ id: 'lt', name: 'Annual', paid: true, defaultDays: 14 }],
        entitlements: [{ id: 'en', userId: 'u1', typeId: 'lt', days: 18 }, { id: 'en2', userId: 'gone', typeId: 'lt', days: 1 }],
        requests: [{ id: 'r1', userId: 'u1', typeId: 'lt', startDate: '2026-11-03', endDate: '2026-11-04', status: 'APPROVED', documentPaths: ['leave/a.jpg'], decidedById: 'adm', recordedById: null, createdAt: new Date() }],
        payProfiles: [{ id: 'pp', userId: 'u1', payType: 'DAILY', dailyRateCentsOverride: 9000, restDays: [7] }],
        holidays: [{ id: 'h1', date: '2026-12-25', name: 'Christmas Day' }],
        audit: [{ id: 'au', actorId: 'adm', action: 'ENTRY_APPROVED', entity: 'TimeEntry', entityId: 'e', createdAt: new Date() }],
        userNames: new Map([['adm', 'Office Admin']]),
      },
      { workers: [{ id: 'W1', siteclockId: 'u1' }] },
      'org',
    );
    expect(plan.upserts.find((u) => u.table === 'fieldLeaveEntitlement')!.data).toMatchObject({ workerId: 'W1', typeId: 'new:fieldLeaveType:lt', days: 18 });
    expect(plan.upserts.find((u) => u.table === 'fieldLeaveRequest')!.data).toMatchObject({ decidedByName: 'Office Admin', documentKeys: ['siteclock:leave/a.jpg'], status: 'APPROVED' });
    expect(plan.upserts.find((u) => u.table === 'fieldPayProfile')!.data).toMatchObject({ workerId: 'W1', payType: 'DAILY', dailyRateCentsOverride: 9000, restDays: [7] });
    expect(plan.upserts.find((u) => u.table === 'fieldAuditImport')!.data).toMatchObject({ actorName: 'Office Admin', action: 'ENTRY_APPROVED' });
    expect(plan.skipped.map((s) => s.siteclockId)).toEqual(['en2']);
  });
});
