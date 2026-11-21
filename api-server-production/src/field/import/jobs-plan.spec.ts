import { planJobs } from './jobs-plan';

describe('SiteClock shadow import, jobs slice', () => {
  const aims = { workers: [{ id: 'W1', siteclockId: 'u1' }], teams: [{ id: 'T1', siteclockId: 't1' }] };
  const sc = {
    jobs: [
      { id: 'j1', date: '2026-11-01', startTime: '09:00', title: 'Ajiya', location: 'Hougang', siteId: 's1', teamIds: ['t1', 'tx'], exceptUserIds: ['u1', 'u9'], qrRequired: true, qrToken: 'q', createdAt: new Date() },
      { id: 'j2', date: '2026-11-02', title: 'DO 12', location: 'Tuas', siteId: 's2', externalSource: 'aims', externalRef: 'aims-delivery:abc', status: 'COMPLETED', teamIds: [], exceptUserIds: [], createdAt: new Date() },
    ],
    crews: [{ id: 'c1', jobId: 'j1', userId: 'u1', teamId: 't1', tradeId: null, notifiedAt: null }, { id: 'c2', jobId: 'j1', userId: 'shared', teamId: null, tradeId: null, notifiedAt: null }],
    needs: [{ id: 'n1', jobId: 'j1', tradeId: 'tr1', qty: 2 }],
    dayNotes: [{ id: 'd1', date: '2026-11-01', text: 'Bring ladders' }],
    templates: [{ id: 'tp1', name: 'Day', startTime: '08:00', endTime: '17:00', daysOfWeek: [1, 2, 3, 4, 5], graceLateMin: 10, active: true, siteIds: ['s1'] }],
    assignments: [{ id: 'a1', templateId: 'tp1', userId: 'u1', startDate: '2026-01-01', endDate: null }],
    presets: [{ id: 'p1', name: 'Std', items: [{ tradeId: 'tr1', qty: 2 }] }],
  };
  it('jobs keep their source; crews / teams / exceptions map to AIMS people; unmatched crew reported', () => {
    const plan = planJobs(sc, aims, 'org');
    const j1 = plan.upserts.find((u) => u.siteclockId === 'j1')!.data;
    expect(j1).toMatchObject({ source: 'siteclock', siteId: 'new:fieldSite:s1', teamIds: ['T1'], exceptWorkerIds: ['W1'], qrToken: 'q' });
    expect(plan.upserts.find((u) => u.siteclockId === 'j2')!.data).toMatchObject({ source: 'siteclock-external', externalRef: 'aims-delivery:abc', status: 'COMPLETED' });
    expect(plan.upserts.find((u) => u.siteclockId === 'c1')!.data).toMatchObject({ jobId: 'new:fieldJob:j1', workerId: 'W1', teamId: 'T1' });
    expect(plan.skipped.map((s) => s.siteclockId)).toEqual(['c2']);
    expect(plan.upserts.find((u) => u.table === 'fieldShiftTemplate')!.data.siteIds).toEqual(['new:fieldSite:s1']);
    expect(plan.upserts.find((u) => u.table === 'fieldShiftAssignment')!.data).toMatchObject({ templateId: 'new:fieldShiftTemplate:tp1', workerId: 'W1' });
    expect(plan.counts.fieldJob).toEqual({ source: 2, upsert: 2, skipped: 0 });
  });
});
