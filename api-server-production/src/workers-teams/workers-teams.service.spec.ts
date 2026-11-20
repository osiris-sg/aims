import { seal } from '../common/secret-box';
import { WorkersTeamsService, syncLogResult } from './workers-teams.service';

// Workers & Teams (WCT 2026-11-20): the service against a fake Prisma and a fake SiteClock (read-only calls only).
const ORG = 'org-wct';

function fakeDb(features: Record<string, unknown> = { enableWorkersTeams: true }) {
  const t = { worker: [] as any[], workerTeam: [] as any[], workerTeamMember: [] as any[] };
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  const where = (row: any, w: any = {}): boolean =>
    Object.entries(w).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && 'not' in v) return row[k] !== v.not;
      if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
      return row[k] === v;
    });
  const table = (name: keyof typeof t, prefix: string) => ({
    findMany: jest.fn(async (a: any = {}) => t[name].filter((r) => where(r, a.where))),
    findFirst: jest.fn(async (a: any = {}) => t[name].find((r) => where(r, a.where)) ?? null),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: id(prefix), active: true, siteclockId: null, siteclockData: null, userId: null, phone: null, role: null, ...data };
      t[name].push(row);
      return row;
    }),
    update: jest.fn(async ({ where: w, data }: any) => {
      const row = t[name].find((r) => r.id === w.id);
      Object.assign(row, data);
      return row;
    }),
    deleteMany: jest.fn(async ({ where: w }: any) => {
      const before = t[name].length;
      t[name] = t[name].filter((r) => !where(r, w));
      return { count: before - t[name].length };
    }),
  });
  const prisma: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features })) },
    siteClockConnection: { findUnique: jest.fn(async () => ({ organizationId: ORG, baseUrl: 'https://sc.test', enabled: true, apiKeyEnc: seal('sck_live_test') })) },
    userOrganization: { findMany: jest.fn(async () => [{ userId: 'u1' }, { userId: 'u2' }]), findFirst: jest.fn(async ({ where: w }: any) => (['u1', 'u2'].includes(w.userId) ? { userId: w.userId } : null)) },
    organizationMemberProfile: { findMany: jest.fn(async () => [{ userId: 'u1', siteclockUserId: 'sc-ali', whatsappNumber: null }]) },
    worker: table('worker', 'w'),
    workerTeam: table('workerTeam', 't'),
    workerTeamMember: table('workerTeamMember', 'm'),
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn({ ...prisma, $executeRawUnsafe: jest.fn(async () => 1) }));
  return { prisma, t };
}

function fakeSiteClock(opts: { phoneScope: boolean }) {
  const calls: Array<{ method: string; url: string }> = [];
  const fetchImpl: any = jest.fn(async (url: string, init: any) => {
    calls.push({ method: init.method, url });
    const json = (status: number, body: any) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    if (url.includes('/v1/workers')) {
      if (url.includes('include=phone') && !opts.phoneScope) return json(403, { error: 'Missing scope', code: 'FORBIDDEN' });
      const phone = url.includes('include=phone');
      return json(200, {
        workers: [
          { id: 'sc-ali', name: 'Ali', role: 'WORKER', active: true, clerkUserId: null, teamIds: ['sc-ta'], employeeNo: 'S1234567A', ...(phone ? { phone: '+6591234567' } : {}) },
          { id: 'sc-kumar', name: 'Kumar', role: 'SUPERVISOR', active: true, clerkUserId: null, teamIds: ['sc-ta'], employeeNo: null, ...(phone ? { phone: '+6598887777' } : {}) },
        ],
      });
    }
    if (url.includes('/v1/teams')) return json(200, { date: '2026-11-20', teams: [{ id: 'sc-ta', name: 'Team A', members: [{ id: 'sc-ali', name: 'Ali' }, { id: 'sc-kumar', name: 'Kumar' }] }] });
    return json(404, { error: 'not found' });
  });
  return { fetchImpl, calls };
}

describe('WorkersTeamsService', () => {
  beforeAll(() => {
    process.env.AIMS_SECRETS_KEY = 'c'.repeat(64);
  });

  it('flag off (every other org): nothing is read or written', async () => {
    const { prisma } = fakeDb({});
    const svc = new WorkersTeamsService(prisma);
    await expect(svc.list(ORG)).rejects.toThrow(/not on/);
    await expect(svc.preview(ORG)).rejects.toThrow(/not on/);
    expect(prisma.worker.findMany).not.toHaveBeenCalled();
    expect(prisma.siteClockConnection.findUnique).not.toHaveBeenCalled();
  });

  it('preview writes nothing and only GETs SiteClock; without the phone scope it retries without phones', async () => {
    const { prisma, t } = fakeDb();
    const sc = fakeSiteClock({ phoneScope: false });
    const svc = new WorkersTeamsService(prisma);
    svc.fetchImpl = sc.fetchImpl;
    const out: any = await svc.preview(ORG);
    expect(out.applied).toBe(false);
    expect(out.source).toMatchObject({ workers: 2, teams: 1, memberships: 2, phones: false });
    expect(out.counts).toMatchObject({ workersCreate: 2, teamsCreate: 1, membershipsAdd: 2, loginsMatched: 1 });
    expect(sc.calls.every((c) => c.method === 'GET')).toBe(true);
    expect(t.worker).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('apply writes workers, the team and memberships; a second apply changes nothing; no employee / ID numbers kept', async () => {
    const { prisma, t } = fakeDb();
    const sc = fakeSiteClock({ phoneScope: true });
    const svc = new WorkersTeamsService(prisma);
    svc.fetchImpl = sc.fetchImpl;
    const first: any = await svc.apply(ORG);
    expect(first.applied).toBe(true);
    expect(t.worker.map((w) => [w.name, w.phone, w.role, w.userId, w.siteclockId])).toEqual([
      ['Ali', '+6591234567', 'WORKER', 'u1', 'sc-ali'],
      ['Kumar', '+6598887777', 'SUPERVISOR', null, 'sc-kumar'],
    ]);
    expect(JSON.stringify(t.worker)).not.toContain('S1234567A');
    expect(t.workerTeam.map((x) => x.name)).toEqual(['Team A']);
    expect(t.workerTeamMember.map((m) => m.source)).toEqual(['siteclock', 'siteclock']);
    expect(syncLogResult(first)).toMatchObject({ applied: true, workers: '+2 new, 0 linked, 0 updated, 0 hidden', memberships: '+2 / -0' });

    const second: any = await svc.apply(ORG);
    expect(second.counts).toMatchObject({ workersCreate: 0, workersUpdate: 0, teamsCreate: 0, membershipsAdd: 0, membershipsRemove: 0 });
    expect(t.worker).toHaveLength(2);
    expect(t.workerTeamMember).toHaveLength(2);
    expect(sc.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('hand edits: hide / unhide never deletes; a login can only be linked once; a team member is added once', async () => {
    const { prisma, t } = fakeDb();
    const svc = new WorkersTeamsService(prisma);
    const a = await svc.createWorker(ORG, { name: '  Guru  ', phone: '9000 0000', userId: 'u2' });
    expect(a).toMatchObject({ name: 'Guru', phone: '9000 0000', userId: 'u2', active: true });
    await expect(svc.createWorker(ORG, { name: 'Other', userId: 'u2' })).rejects.toThrow(/already linked to Guru/);
    await expect(svc.createWorker(ORG, { name: 'X', userId: 'stranger' })).rejects.toThrow(/not an active member/);
    await svc.setWorkerActive(ORG, a.id, false);
    expect(t.worker[0].active).toBe(false);
    await svc.setWorkerActive(ORG, a.id, true);
    const team = await svc.createTeam(ORG, { name: 'Team B', workerIds: [a.id] });
    await svc.addMember(ORG, team.id, a.id);
    expect(t.workerTeamMember).toHaveLength(1);
    expect(await svc.removeMember(ORG, team.id, a.id)).toEqual({ removed: 1 });
    expect(t.worker).toHaveLength(1);
    const picker = await svc.picker(ORG);
    expect(picker).toEqual({ teams: [{ id: team.id, name: 'Team B', workerIds: [] }], workers: [{ id: a.id, name: 'Guru' }] });
  });
});
