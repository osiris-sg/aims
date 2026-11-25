import { crewSiteClockIds } from './siteclock-crew';

const ORG = 'org1';
const ali = { id: 'A', name: 'Ali', siteclockId: 'w1', active: true };
const ben = { id: 'B', name: 'Ben', siteclockId: 'w2', active: true };
const cal = { id: 'C', name: 'Cal', siteclockId: null, active: true };
const dan = { id: 'D', name: 'Dan', siteclockId: 'w4', active: false };
const eve = { id: 'E', name: 'Eve (WCT Racking)', siteclockId: 'w5', active: true };
const prisma = (teams: any[], workers: any[]) => ({
  workerTeam: { findMany: async ({ where }: any) => teams.filter((t) => t.organizationId === where.organizationId && where.id.in.includes(t.id) && t.active) },
  worker: { findMany: async ({ where }: any) => workers.filter((w) => where.id.in.includes(w.id)) },
});
const teamA = { id: 'T', organizationId: ORG, name: 'A', siteclockId: 't1', active: true, members: [{ worker: ben }, { worker: ali }, { worker: dan }, { worker: cal }] };

describe('crewSiteClockIds', () => {
  it('a team gives its active members by name and its own id; a worker pick gives the worker; no repeats', async () => {
    const r = await crewSiteClockIds(prisma([teamA], [ben, eve]), ORG, [
      { kind: 'team', id: 'T', name: 'A' },
      { kind: 'worker', id: 'B', name: 'Ben' },
      { kind: 'worker', id: 'E', name: 'Eve (WCT Racking)' },
    ]);
    expect(r.ids).toEqual(['w1', 'w2', 'w5']);
    expect(r.teamIds).toEqual(['t1']);
    expect(r.names.get('w5')).toBe('Eve (WCT Racking)');
    expect(r.unsent).toEqual(['Cal']); // not in SiteClock; Dan is inactive and simply left out
  });

  it('a team with no SiteClock id still sends its people; a hidden team or another org\'s sends nobody', async () => {
    const byHand = { ...teamA, id: 'H', siteclockId: null, members: [{ worker: ali }] };
    const hidden = { ...teamA, id: 'X', active: false };
    const foreign = { ...teamA, id: 'F', organizationId: 'org2' };
    const r = await crewSiteClockIds(prisma([byHand, hidden, foreign], []), ORG, [
      { kind: 'team', id: 'H', name: 'H' },
      { kind: 'team', id: 'X', name: 'X' },
      { kind: 'team', id: 'F', name: 'F' },
    ]);
    expect(r).toMatchObject({ ids: ['w1'], teamIds: [], unsent: [] });
  });

  it('extra SiteClock workers stored on the job follow the picks; nothing picked gives nobody', async () => {
    expect((await crewSiteClockIds(prisma([], [ali]), ORG, [{ kind: 'worker', id: 'A', name: 'Ali' }], [{ id: 'w9', name: 'Zed' }, { id: 'w1', name: 'Ali' }])).ids).toEqual(['w1', 'w9']);
    expect(await crewSiteClockIds(prisma([], []), ORG, [])).toMatchObject({ ids: [], teamIds: [], unsent: [] });
  });
});
