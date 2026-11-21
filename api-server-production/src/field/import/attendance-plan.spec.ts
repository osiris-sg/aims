import { planAttendance } from './attendance-plan';

describe('SiteClock shadow import, attendance slice', () => {
  it('entries keep SiteClock\'s numbers, map people / sites / shared-company minutes; punches keep review data and selfie paths', () => {
    const plan = planAttendance(
      {
        overtimeRules: [{ id: 'ot', siteId: null, dailyThresholdMin: 528, otMultiplier: 1.5 }],
        breakRules: [{ id: 'br', siteId: 's1', deductMinutes: 60, minShiftMinutes: 360, nlbCreditMinutes: 0 }],
        entries: [
          { id: 'e1', userId: 'u1', siteId: 's1', workDate: '2026-11-02', clockInAt: new Date(), clockOutAt: new Date(), status: 'APPROVED', grossMinutes: 600, otMinutes: 12, editedById: 'adm', approvedById: 'adm', workedFor: { cB: 90, cX: 10 } },
          { id: 'e2', userId: 'gone', siteId: 's1', workDate: '2026-11-02', clockInAt: new Date(), status: 'OPEN' },
        ],
        punches: [{ id: 'p1', userId: 'u1', siteId: 's1', jobId: 'j1', timeEntryId: 'e1', type: 'IN', status: 'APPROVED', photoPath: 'punches/a.jpg', reviewedById: 'adm', recordedById: 'u1', lat: 1, lng: 1 }],
      },
      { workers: [{ id: 'W1', siteclockId: 'u1' }], orgOfCompany: new Map([['cB', 'org-B']]) },
      'org',
    );
    const e1 = plan.upserts.find((u) => u.siteclockId === 'e1')!.data;
    expect(e1).toMatchObject({ workerId: 'W1', siteId: 'new:fieldSite:s1', grossMinutes: 600, otMinutes: 12, status: 'APPROVED', editedById: 'siteclock:adm', workedFor: { 'org-B': 90, 'siteclock:cX': 10 } });
    expect(plan.skipped.map((s) => s.siteclockId)).toEqual(['e2']);
    const p1 = plan.upserts.find((u) => u.siteclockId === 'p1')!.data;
    expect(p1).toMatchObject({ timeEntryId: 'new:fieldTimeEntry:e1', jobId: 'new:fieldJob:j1', photoKey: 'siteclock:punches/a.jpg', reviewedById: 'siteclock:adm', recordedByWorkerId: 'W1' });
    expect(plan.upserts.find((u) => u.table === 'fieldBreakRule')!.data.siteId).toBe('new:fieldSite:s1');
  });
});
