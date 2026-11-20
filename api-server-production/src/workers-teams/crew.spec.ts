import { crewOf, crewText, parseJobStylePatch, CREW_MAX } from '../deliveries/job-style';
import { resolveCrew } from './crew';

// Round 39 B4 (Workers & Teams, WCT (S)): a job's Team / crew = picked teams / workers + the free text kept.
describe('job crew picks', () => {
  it('clean picks: known kinds, no blanks or duplicates, at most CREW_MAX', () => {
    expect(crewOf([{ kind: 'team', id: 't1', name: ' Team  A ' }, { kind: 'team', id: 't1', name: 'again' }, { kind: 'boss', id: 'x' }, { kind: 'worker', id: '' }, null, { kind: 'worker', id: 'w1', name: 'Guru' }])).toEqual([
      { kind: 'team', id: 't1', name: 'Team A' },
      { kind: 'worker', id: 'w1', name: 'Guru' },
    ]);
    expect(crewOf(Array.from({ length: 20 }, (_, i) => ({ kind: 'worker', id: `w${i}`, name: `W${i}` })))).toHaveLength(CREW_MAX);
    expect(crewOf('junk')).toEqual([]);
  });

  it('the text: picks first, then the free text (existing free text stays as it was)', () => {
    expect(crewText({ crew: [{ kind: 'team', id: 't1', name: 'Team A' }, { kind: 'worker', id: 'w1', name: 'Guru' }], team: null })).toBe('Team A + Guru');
    expect(crewText({ crew: [{ kind: 'team', id: 't1', name: 'Team A' }], team: 'Ali (lorry)' })).toBe('Team A + Ali (lorry)');
    expect(crewText({ crew: [], team: 'Team B + Ah Seng' })).toBe('Team B + Ah Seng');
    expect(crewText({ crew: [], team: null })).toBeNull();
  });

  it('a form patch carries the picks; text is still accepted alone', () => {
    expect(parseJobStylePatch({ crew: [{ kind: 'team', id: 't1', name: 'A' }] })).toEqual({ crew: [{ kind: 'team', id: 't1', name: 'A' }] });
    expect(parseJobStylePatch({ team: 'Team B' })).toEqual({ team: 'Team B' });
    expect(() => parseJobStylePatch({ crew: 'Team A' })).toThrow();
  });

  it("picks are checked against the org's own tables (names re-read); orgs without Workers & Teams keep none", async () => {
    const prisma: any = {
      organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableWorkersTeams: true } })) },
      workerTeam: { findMany: jest.fn(async ({ where }: any) => [{ id: 't1', name: 'Team A (renamed)' }].filter((t) => where.organizationId === 'wct' && where.id.in.includes(t.id))) },
      worker: { findMany: jest.fn(async ({ where }: any) => [{ id: 'w1', name: 'Guru' }].filter((w) => where.organizationId === 'wct' && where.id.in.includes(w.id))) },
    };
    const picks = [
      { kind: 'team' as const, id: 't1', name: 'Team A' },
      { kind: 'worker' as const, id: 'w1', name: 'x' },
      { kind: 'worker' as const, id: 'w-other-org', name: 'Nope' },
    ];
    expect(await resolveCrew(prisma, 'wct', picks)).toEqual([
      { kind: 'team', id: 't1', name: 'Team A (renamed)' },
      { kind: 'worker', id: 'w1', name: 'Guru' },
    ]);
    const off: any = { ...prisma, organizationUIConfig: { findUnique: jest.fn(async () => ({ features: {} })) } };
    expect(await resolveCrew(off, 'other', picks)).toEqual([]);
    expect(off.worker.findMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'other' }) }));
  });
});
