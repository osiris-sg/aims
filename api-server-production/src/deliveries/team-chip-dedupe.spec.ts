import { crewText, dedupeCrewTeam, jobStyleOf, saveJobStyle } from './job-style';

// 2026-11-24 (WCT group): "Team / crew" chips duplicated ("Team A" twice) or came back after a delete. The stored
// value is cleaned on every read and save: a pick once, a piece of free text once (any case), never a pick's name.
const A = { kind: 'team' as const, id: 't1', name: 'Team A' };
const GURU = { kind: 'worker' as const, id: 'w1', name: 'Guru' };

describe('team / crew chip duplicates', () => {
  it('free text equal to a pick name (any case) is dropped; other text kept as typed', () => {
    expect(dedupeCrewTeam([A], 'Team A')).toEqual({ crew: [A], team: null });
    expect(dedupeCrewTeam([A, GURU], 'team a + GURU + Ali (lorry)')).toEqual({ crew: [A, GURU], team: 'Ali (lorry)' });
    expect(dedupeCrewTeam([], 'Team B + team b + Ah Seng')).toEqual({ crew: [], team: 'Team B + Ah Seng' });
    expect(dedupeCrewTeam([], 'Team A, Guru')).toEqual({ crew: [], team: 'Team A, Guru' });
    expect(dedupeCrewTeam([], '+2pt')).toEqual({ crew: [], team: '+2pt' });
  });

  it('a pick once: same id, or same kind and name; a team and a worker of one name are both kept', () => {
    const A2 = { kind: 'team' as const, id: 't2', name: 'team a' };
    const guruTeam = { kind: 'team' as const, id: 't3', name: 'Guru' };
    expect(dedupeCrewTeam([A, A2, A], null).crew).toEqual([A]);
    expect(dedupeCrewTeam([GURU, guruTeam], null).crew).toEqual([GURU, guruTeam]);
  });

  it('reads and the shown text never repeat a name', () => {
    const m = jobStyleOf({ crew: [A], team: 'Team A + team A' });
    expect(m.crew).toEqual([A]);
    expect(m.team).toBeNull();
    expect(crewText({ crew: [A], team: 'TEAM A' })).toBe('Team A');
  });

  it('a save stores the clean value; a deleted chip stays deleted', async () => {
    let stored: any = { crew: [A], team: 'Team A' };
    const prisma: any = {
      customField: { findFirst: jest.fn(async () => ({ id: 'f1' })) },
      customFieldValue: {
        findUnique: jest.fn(async () => ({ value: stored })),
        upsert: jest.fn(async ({ update }: any) => {
          stored = update.value;
          return {};
        }),
      },
    };
    // The picker deletes the Team A pick (the stale free-text "Team A" is not sent back any more).
    const after = await saveJobStyle(prisma, 'wct', 'job1', { crew: [], team: null });
    expect(after.crew).toEqual([]);
    expect(after.team).toBeNull();
    expect(crewText(jobStyleOf(stored))).toBeNull();
    // An older save that still carries the duplicate text is cleaned on save.
    const again = await saveJobStyle(prisma, 'wct', 'job1', { crew: [A], team: 'team a + Ali' });
    expect(again).toMatchObject({ crew: [A], team: 'Ali' });
  });
});
