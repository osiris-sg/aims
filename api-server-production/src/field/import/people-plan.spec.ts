import { planPeople, scFileKey, type ScPeople } from './people-plan';

const user = (id: string, over: Record<string, any> = {}) => ({
  id, companyId: 'c1', phone: `+65900000${id}`, name: `User ${id}`, role: 'WORKER', employeeNo: null, deviceId: null, deviceBoundAt: null,
  deviceVerified: true, lastBindPhotoPath: null, faceDescriptor: null, verifyRequested: false, active: true, termsAcceptedVersion: null,
  termsAcceptedAt: null, attendanceExempt: false, payslipVisible: false, jobClocking: null, offSiteClocking: null, selfiePolicy: null,
  baseClocking: null, payFollowsCrew: false, crewMarginBeforeMin: null, crewMarginAfterMin: null, sharedWithLinked: false,
  companyRoleName: 'Worker', createdAt: new Date('2026-01-01'), ...over,
});

function source(): ScPeople {
  return {
    company: { id: 'c1', timezone: 'Asia/Singapore', selfiePolicy: 'ALWAYS', jobClockingTeamIds: ['t1', 'tx'], shareWorkers: 'NONE', crewMarginBeforeMin: 15 },
    users: [user('u1', { selfiePolicy: 'ALWAYS', lastBindPhotoPath: 'binds/a.jpg' }), user('u2'), user('sa', { role: 'SUPERADMIN' }), user('u9')],
    teams: [{ id: 't1', name: 'Team A', active: true }, { id: 'tx', name: 'Team X', active: true }],
    memberships: [{ id: 'm1', teamId: 't1', userId: 'u1', startDate: '2026-01-01', endDate: null }, { id: 'm2', teamId: 'tx', userId: 'u2', startDate: '2026-01-01', endDate: null }],
    teamSupervisors: [{ id: 'ts1', teamId: 't1', userId: 'u2' }],
    sites: [{ id: 's1', name: 'Yard', lat: 1.3, lng: 103.8, radiusM: 150, timezone: 'Asia/Singapore', maxAccuracyM: 50, autoCloseAfterH: 14, active: true, kind: 'BASE', allWorkers: true }],
    siteAssignments: [{ id: 'a1', userId: 'u1', siteId: 's1', isSupervisor: true }],
    trades: [{ id: 'tr1', name: 'Electrician' }],
    userTrades: [{ userId: 'u1', tradeId: 'tr1' }],
    invites: [{ id: 'i1', token: 'tok', siteId: 's1', templateIds: ['tpl1'], active: true, uses: 0, createdAt: new Date() }],
    registrations: [{ id: 'r1', inviteId: 'i1', phone: '+6581111111', name: 'Joiner', status: 'PENDING', photoPath: 'registrations/x.jpg', createdAt: new Date() }],
    photoUpdates: [{ id: 'p1', userId: 'u1', status: 'PENDING', photoPath: 'binds/b.jpg', auto: false, setVerify: false, createdAt: new Date() }],
  };
}

describe('SiteClock shadow import, people slice', () => {
  const aims = { workers: [{ id: 'W1', siteclockId: 'u1' }, { id: 'W2', siteclockId: 'u2' }], teams: [{ id: 'T1', siteclockId: 't1' }], existing: {} };

  it('matches only people and teams the Workers & Teams sync brought in; never creates them', () => {
    const plan = planPeople(source(), aims, 'org');
    const profiles = plan.upserts.filter((u) => u.table === 'fieldWorkerProfile');
    expect(profiles.map((p) => p.data.workerId)).toEqual(['W1', 'W2']); // superadmin left out, u9 not matched
    expect(plan.skipped.map((s) => `${s.table}:${s.siteclockId}`)).toEqual(expect.arrayContaining(['fieldWorkerProfile:u9', 'team:tx', 'fieldTeamStint:m2']));
    expect(plan.upserts.some((u) => ['worker', 'workerTeam', 'workerTeamMember'].includes(u.table))).toBe(false);
  });

  it('keeps every per-worker rule, the tier and the face / photo data (paths until the files are copied)', () => {
    const plan = planPeople(source(), aims, 'org');
    const p1 = plan.upserts.find((u) => u.table === 'fieldWorkerProfile' && u.siteclockId === 'u1')!.data;
    expect(p1).toMatchObject({ organizationId: 'org', siteclockId: 'u1', workerId: 'W1', tier: 'WORKER', selfiePolicy: 'ALWAYS', photoKey: 'siteclock:binds/a.jpg' });
    expect(scFileKey(null)).toBeNull();
  });

  it('settings: company rules copied; job clocking teams mapped to AIMS teams (unmatched dropped)', () => {
    const s = planPeople(source(), aims, 'org').upserts.find((u) => u.table === 'fieldSettings')!.data;
    expect(s).toMatchObject({ siteclockCompanyId: 'c1', selfiePolicy: 'ALWAYS', jobClockingTeamIds: ['T1'], crewMarginBeforeMin: 15 });
  });

  it('sites, assignments, trades, invites, join requests and photos carry SiteClock ids; references resolve to Field rows', () => {
    const plan = planPeople(source(), aims, 'org');
    const a = plan.upserts.find((u) => u.table === 'fieldSiteAssignment')!.data;
    expect(a).toMatchObject({ siteId: 'new:fieldSite:s1', workerId: 'W1', isSupervisor: true });
    const inv = plan.upserts.find((u) => u.table === 'fieldInvite')!.data;
    expect(inv).toMatchObject({ siteId: 'new:fieldSite:s1', templateIds: ['new:fieldShiftTemplate:tpl1'] });
    const again = planPeople(source(), { ...aims, existing: { fieldSite: new Map([['s1', 'S1']]) } }, 'org');
    expect(again.upserts.find((u) => u.table === 'fieldSiteAssignment')!.data.siteId).toBe('S1'); // re-run: same row
    expect(plan.counts.fieldSite).toEqual({ source: 1, upsert: 1, skipped: 0 });
  });
});
