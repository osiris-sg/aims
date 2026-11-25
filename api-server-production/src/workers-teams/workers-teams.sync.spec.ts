import { matchLogin, planSync, withSharedWorkers, samePhone, type AimsTeam, type AimsWorker, type Candidate, type ScTeam, type ScWorker } from './workers-teams.sync';

// Workers & Teams (WCT 2026-11-20): the SiteClock -> AIMS sync plan.
const sc = (id: string, name: string, over: Partial<ScWorker> = {}): ScWorker => ({ id, name, role: 'WORKER', active: true, clerkUserId: null, phone: null, teamIds: [], ...over });
const aw = (id: string, name: string, over: Partial<AimsWorker> = {}): AimsWorker => ({ id, name, phone: null, role: null, active: true, siteclockId: null, siteclockData: null, userId: null, ...over });
const team = (id: string, name: string, members: string[]): ScTeam => ({ id, name, members: members.map((m) => ({ id: m })) });
const at = (id: string, name: string, over: Partial<AimsTeam> = {}): AimsTeam => ({ id, name, active: true, siteclockId: null, siteclockData: null, ...over });
const cand = (userId: string, name: string, over: Partial<Candidate> = {}): Candidate => ({ userId, name, phones: [], clerkId: null, siteclockUserId: null, ...over });
const base = { scWorkers: [] as ScWorker[], scTeams: [] as ScTeam[], phones: true, workers: [] as AimsWorker[], teams: [] as AimsTeam[], members: [] as any[], candidates: [] as Candidate[] };

describe('workers & teams sync plan', () => {
  it('first import: workers and teams created, memberships added, logins matched (profile link, clerk, phone, name)', () => {
    const p = planSync({
      ...base,
      scWorkers: [sc('s1', 'Ali Bin Abu', { phone: '+65 9123 4567' }), sc('s2', 'Kumar Raj', { clerkUserId: 'clerk_k' }), sc('s3', 'Tan Wei', { phone: '91110000' }), sc('s4', 'Lim Ah Kow'), sc('s5', 'Nobody Here')],
      scTeams: [team('t1', 'Team A', ['s1', 's2']), team('t2', 'Team B', ['s3'])],
      candidates: [
        cand('u1', 'Ali', { siteclockUserId: 's1' }),
        cand('u2', 'K Raj', { clerkId: 'clerk_k' }),
        cand('u3', 'Wei', { phones: ['6591110000'] }),
        cand('u4', 'lim ah kow'),
      ],
    });
    expect(p.counts).toMatchObject({ workersCreate: 5, teamsCreate: 2, membershipsAdd: 3, loginsMatched: 4, loginsUnmatched: 1, differences: 0 });
    expect(p.workers.map((w) => [w.name, w.user?.by ?? null])).toEqual([
      ['Ali Bin Abu', 'profile'],
      ['Kumar Raj', 'clerk'],
      ['Tan Wei', 'phone'],
      ['Lim Ah Kow', 'name'],
      ['Nobody Here', null],
    ]);
    expect(p.workers[0].data).toEqual({ name: 'Ali Bin Abu', phone: '+65 9123 4567', role: 'WORKER', active: true });
    // Nothing beyond name / phone / role / active is kept from SiteClock.
    expect(Object.keys(p.workers[0].snapshot).sort()).toEqual(['active', 'name', 'phone', 'role']);
  });

  it('re-run with nothing new in SiteClock: nothing to do (idempotent on the SiteClock id)', () => {
    const snap = { name: 'Ali', phone: '91234567', role: 'WORKER', active: true };
    const p = planSync({
      ...base,
      scWorkers: [sc('s1', 'Ali', { phone: '91234567' })],
      scTeams: [team('t1', 'Team A', ['s1'])],
      workers: [aw('w1', 'Ali', { phone: '91234567', role: 'WORKER', siteclockId: 's1', siteclockData: snap, userId: 'u1' })],
      teams: [at('a1', 'Team A', { siteclockId: 't1', siteclockData: { name: 'Team A', memberIds: ['s1'], active: true } })],
      members: [{ teamId: 'a1', workerId: 'w1', source: 'siteclock' }],
    });
    expect(p.counts).toMatchObject({ workersCreate: 0, workersUpdate: 0, workersSame: 1, teamsCreate: 0, teamsUpdate: 0, membershipsAdd: 0, membershipsRemove: 0, differences: 0 });
  });

  it('three-way: a SiteClock change updates a field nobody edited in AIMS; an AIMS edit is kept and reported', () => {
    const snap = { name: 'Ali', phone: '91234567', role: 'WORKER', active: true };
    const p = planSync({
      ...base,
      scWorkers: [sc('s1', 'Ali Abu', { phone: '98887777', role: 'SUPERVISOR' })],
      // AIMS renamed him to "Ali (Team A)" by hand; phone and role untouched since the last import.
      workers: [aw('w1', 'Ali (Team A)', { phone: '91234567', role: 'WORKER', siteclockId: 's1', siteclockData: snap, userId: 'u1' })],
    });
    const w = p.workers[0];
    expect(w.action).toBe('update');
    expect(w.changes).toEqual({ phone: { from: '91234567', to: '98887777' }, role: { from: 'WORKER', to: 'SUPERVISOR' } });
    expect(w.differences).toEqual([{ field: 'name', aims: 'Ali (Team A)', siteclock: 'Ali Abu' }]);
    expect(w.data.name).toBe('Ali (Team A)');
  });

  it('inactive in SiteClock (or gone): hidden in AIMS unless AIMS changed it; without the phone scope the phone is left alone', () => {
    const snap = { name: 'Ali', role: 'WORKER', active: true };
    const p = planSync({
      ...base,
      phones: false,
      scWorkers: [sc('s1', 'Ali', { active: false, phone: '99999999' })],
      workers: [aw('w1', 'Ali', { phone: '91234567', role: 'WORKER', siteclockId: 's1', siteclockData: snap, userId: 'u1' }), aw('w2', 'Gone', { siteclockId: 's9', siteclockData: { name: 'Gone', active: true }, userId: 'u2' })],
    });
    expect(p.workers[0].changes).toEqual({ active: { from: true, to: false } });
    expect(p.workers[0].data.phone).toBe('91234567');
    expect(p.workers.find((w) => w.siteclockId === 's9')!.changes).toEqual({ active: { from: true, to: false } });
    expect(p.counts.workersHidden).toBe(2);
  });

  it('a worker added by hand is linked (same phone, else the same name), never duplicated', () => {
    const p = planSync({
      ...base,
      scWorkers: [sc('s1', 'Ali Bin Abu', { phone: '+6591234567' }), sc('s2', 'Kumar')],
      workers: [aw('w1', 'Ali', { phone: '91234567' }), aw('w2', 'kumar')],
    });
    expect(p.workers.map((w) => [w.action, w.aimsId])).toEqual([
      ['link', 'w1'],
      ['link', 'w2'],
    ]);
    // The hand-typed name differs from SiteClock's: kept, reported.
    expect(p.workers[0].differences).toEqual([{ field: 'name', aims: 'Ali', siteclock: 'Ali Bin Abu' }]);
  });

  it('memberships: SiteClock drops one = removed; one removed in AIMS after an import is not put back; manual ones stay', () => {
    const w = (id: string, s: string) => aw(id, id, { siteclockId: s, siteclockData: { name: id, role: 'WORKER', active: true, phone: null }, role: 'WORKER', userId: `u-${id}` });
    const p = planSync({
      ...base,
      scWorkers: [sc('s1', 'w1'), sc('s2', 'w2'), sc('s3', 'w3')],
      scTeams: [team('t1', 'Team A', ['s1', 's3'])],
      workers: [w('w1', 's1'), w('w2', 's2'), w('w3', 's3'), aw('w4', 'Guru')],
      teams: [at('a1', 'Team A', { siteclockId: 't1', siteclockData: { name: 'Team A', memberIds: ['s1', 's2', 's3'], active: true } })],
      members: [
        { teamId: 'a1', workerId: 'w1', source: 'siteclock' },
        { teamId: 'a1', workerId: 'w2', source: 'siteclock' }, // SiteClock dropped s2
        { teamId: 'a1', workerId: 'w4', source: 'manual' }, // added by hand
        // s3 was removed in AIMS after the last import
      ],
    });
    expect(p.memberships.remove.map((m) => m.workerSiteclockId)).toEqual(['s2']);
    expect(p.memberships.add).toEqual([]);
    expect(p.memberships.keptRemoved.map((m) => m.workerSiteclockId)).toEqual(['s3']);
  });

  it('a login already linked to another worker is never reused', () => {
    expect(samePhone('+65 9123 4567', '91234567')).toBe(true);
    expect(samePhone('123', '123')).toBe(false);
    const m = matchLogin(sc('s1', 'Ali'), [cand('u1', 'Ali')], new Set(['u1']));
    expect(m).toEqual({ none: 'Its AIMS login is already linked to another worker' });
    // Two members with the same name: no guess.
    expect(matchLogin(sc('s1', 'Ali'), [cand('u1', 'Ali'), cand('u2', 'ali')], new Set())).toEqual({ none: 'No AIMS login matches' });
  });
  it('crew sync: shared workers of a linked company join the list named with their company; one already listed is left alone', () => {
    const own: ScWorker[] = [{ id: 's1', name: 'Ali', role: 'WORKER', active: true, teamIds: ['t1'] }];
    const out = withSharedWorkers(own, [
      { id: 'r1', name: 'Eve', companyName: 'WCT Racking' },
      { id: 's1', name: 'Ali', companyName: 'WCT Racking' },
      { id: 'r2', name: 'Raj' },
    ]);
    expect(out).toEqual([
      own[0],
      { id: 'r1', name: 'Eve (WCT Racking)', role: 'WORKER', active: true, teamIds: [] },
      { id: 'r2', name: 'Raj', role: 'WORKER', active: true, teamIds: [] },
    ]);
    expect(withSharedWorkers(own, [])).toEqual(own);
  });
});
