import { SiteClockLinkService, normaliseApiKey } from './siteclock-link.service';
import { seal } from '../common/secret-box';

// ── an in-memory Prisma with just the calls the service makes ──────────────
type Row = Record<string, any>;
const matches = (row: Row, where: Row = {}): boolean =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(row[k]);
      if ('lte' in v) return row[k] <= v.lte;
    }
    return row[k] === v;
  });
let seq = 0;
function table(rows: Row[] = [], defaults: () => Row = () => ({})) {
  return {
    rows,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where)),
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    create: async ({ data }: any) => {
      const r = { id: `id${++seq}`, ...defaults(), ...data, createdAt: new Date(), updatedAt: new Date() };
      rows.push(r);
      return r;
    },
    update: async ({ where, data }: any) => {
      const r = rows.find((x) => matches(x, where));
      if (!r) throw new Error('P2025');
      Object.assign(r, data, { updatedAt: new Date() });
      return r;
    },
  };
}

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const OTHER = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const KEY = 'sck_live_TESTKEY0123456789abcdef';

function world() {
  process.env.AIMS_SECRETS_KEY = 'c'.repeat(64);
  const linkDefaults = () => ({
    workerName: null,
    durationMin: 60,
    generation: 1,
    siteclockJobId: null,
    siteRef: null,
    syncedHash: null,
    lastPushedStatus: null,
    syncState: 'PENDING',
    attempts: 0,
    nextAttemptAt: new Date(),
    lastError: null,
    lastSyncedAt: null,
    alertedAt: null,
  });
  const prisma: any = {
    siteClockConnection: table([
      {
        id: 'conn1',
        organizationId: WCT,
        baseUrl: 'http://sc.test',
        siteclockCompanyId: 'cmpWCT',
        apiKeyEnc: seal(KEY),
        apiKeyLast4: KEY.slice(-4),
        enabled: true,
        defaultDurationMin: 60,
        lastOkAt: null,
        lastError: null,
      },
    ]),
    organizationUIConfig: table([
      { organizationId: WCT, features: { enableSiteClockLink: true } },
      { organizationId: OTHER, features: { enableDeliveryGroupPosts: true } },
    ]),
    deliverySiteClockJob: table([], linkDefaults),
    delivery: table([]),
    asset: table([]),
  };
  const bells: any[] = [];
  const notifications: any = { emit: async (p: any) => void bells.push(p) };
  const logs: any[] = [];
  const actionLog: any = { system: (...a: any[]) => void logs.push(a) };
  const svc = new SiteClockLinkService(prisma, notifications, actionLog);

  // ── a fake SiteClock /v1 that follows the agreed contract ──
  const sc = { sites: new Map<string, Row>(), jobs: new Map<string, Row>(), calls: [] as string[], down: false };
  svc.fetchImpl = (async (url: string, init: any) => {
    const u = new URL(url);
    const method = init.method;
    sc.calls.push(`${method} ${decodeURIComponent(u.pathname)}`);
    if (sc.down) throw new TypeError('fetch failed');
    if (init.headers.Authorization !== `Bearer ${KEY}`) return reply(401, { error: 'Invalid API key', code: 'UNAUTHORIZED' });
    const body = init.body ? JSON.parse(init.body) : {};
    const m = decodeURIComponent(u.pathname).match(/^\/v1\/(sites|jobs)(?:\/by-ref\/([^/]+))?(\/cancel)?$/);
    if (u.pathname === '/v1/teams') return reply(200, { date: '2026-11-03', teams: [{ id: 't1', name: 'Team A', members: [{ id: 'w1', name: 'Ali', employeeNo: 'E1' }] }] });
    if (u.pathname === '/v1/workers')
      return reply(200, {
        workers: [
          { id: 'w1', name: 'Ali', employeeNo: 'E1', role: 'WORKER', active: true, teamIds: ['t1'] },
          { id: 'w2', name: 'Ben', employeeNo: null, role: 'WORKER', active: true, teamIds: [] },
        ],
      });
    if (!m) return reply(404, { error: 'Not found', code: 'NOT_FOUND' });
    const [, kind, ref, cancel] = m;
    if (kind === 'sites') {
      if (/nowhere/i.test(body.address)) return reply(422, { error: 'not on the map', code: 'ADDRESS_NOT_FOUND' });
      const existed = sc.sites.has(ref);
      sc.sites.set(ref, { id: `site:${ref}`, externalRef: ref, ...body });
      return reply(existed ? 200 : 201, { site: sc.sites.get(ref) });
    }
    if (method === 'POST' && !ref) {
      if (!/[+-]\d\d:\d\d$|Z$/.test(body.startAt)) return reply(400, { error: 'offset required', code: 'VALIDATION' });
      if (!sc.sites.has(body.siteRef)) return reply(422, { error: 'no site', code: 'SITE_NOT_FOUND' });
      const ex = sc.jobs.get(body.externalRef);
      if (ex)
        return ex.workerId === body.workerId && ex.startAt === body.startAt
          ? reply(200, { job: present(ex), duplicate: true })
          : reply(409, { error: 'conflict', code: 'EXTERNAL_REF_CONFLICT', job: present(ex) });
      const job = { id: `job${sc.jobs.size + 1}`, status: 'SCHEDULED', ...body };
      sc.jobs.set(body.externalRef, job);
      return reply(201, { job: present(job) });
    }
    const job = sc.jobs.get(ref);
    if (!job) return reply(404, { error: 'Job not found', code: 'NOT_FOUND' });
    if (cancel) {
      if (job.status === 'COMPLETED') return reply(409, { error: 'completed', code: 'JOB_CLOSED' });
      if (job.status === 'CANCELLED') return reply(200, { job: present(job), unchanged: true });
      job.status = 'CANCELLED';
      job.cancelReason = body.reason;
      return reply(200, { job: present(job) });
    }
    if (method === 'PATCH') {
      if (job.status === 'CANCELLED') return reply(409, { error: 'cancelled', code: 'JOB_CLOSED' });
      if (body.status) {
        const rank: Row = { SCHEDULED: 1, IN_PROGRESS: 2, COMPLETED: 3 };
        if (rank[body.status] < rank[job.status]) return reply(409, { error: 'backwards', code: 'INVALID_TRANSITION' });
        if (rank[body.status] === rank[job.status]) return reply(200, { job: present(job), unchanged: true });
        job.status = body.status;
        job[body.status === 'IN_PROGRESS' ? 'startedAt' : 'completedAt'] = body.at;
        return reply(200, { job: present(job), changes: ['status'] });
      }
      if (job.status !== 'SCHEDULED' && (body.startAt || body.workerId)) return reply(409, { error: 'started', code: 'JOB_STARTED' });
      Object.assign(job, body);
      return reply(200, { job: present(job), changes: ['x'] });
    }
    if (method === 'GET') return reply(200, { job: present(job) });
    return reply(404, { error: 'Not found', code: 'NOT_FOUND' });
  }) as any;
  const present = (j: Row) => ({ id: j.id, externalRef: j.externalRef, status: j.status, worker: { id: j.workerId, name: 'x' }, startAt: j.startAt, endAt: j.endAt });
  const reply = (status: number, body: any) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) }) as any;

  const addRun = (o: Row = {}) => {
    const r = {
      id: `run${++seq}`,
      organizationId: WCT,
      deliveryNumber: seq,
      status: 'scheduled',
      isDraft: false,
      scheduledFor: new Date('2026-11-03T02:00:00Z'),
      startedAt: new Date('2026-10-30T00:00:00Z'),
      completedAt: null,
      siteAddress: '1 Tuas Ave 8',
      notes: null,
      customerId: 'c1',
      customer: { name: 'Acme' },
      project: null,
      items: [{ description: 'Degrease', quantity: 1, assetId: null }],
      ...o,
    };
    prisma.delivery.rows.push(r);
    return r;
  };
  const linkOf = (deliveryId: string) => prisma.deliverySiteClockJob.rows.find((l: Row) => l.deliveryId === deliveryId);
  // The hooks start the sync in the background; let it finish.
  const settle = () => new Promise((r) => setTimeout(r, 20));
  return { svc, prisma, sc, bells, logs, addRun, linkOf, settle };
}

describe('SiteClockLinkService', () => {
  it('does nothing at all for an org without the flag', async () => {
    const w = world();
    const run = w.addRun({ organizationId: OTHER });
    await w.svc.onScheduleSaved(OTHER, run.id, { workerId: 'w1', workerName: 'Ali' });
    await w.svc.touch(OTHER, run.id);
    await w.settle();
    expect(w.prisma.deliverySiteClockJob.rows).toHaveLength(0);
    expect(w.sc.calls).toEqual([]);
    expect((await w.svc.viewsFor(OTHER, [run.id])).size).toBe(0);
    expect(await w.svc.formConfig(OTHER)).toEqual({ enabled: false });
  });

  it('schedule → reschedule → reassign → start → complete', async () => {
    const w = world();
    const run = w.addRun();
    await w.svc.onScheduleSaved(WCT, run.id, { workerId: 'w1', workerName: 'Ali', durationMin: 90 });
    await w.settle();
    const ref = `aims-delivery:${run.id}`;
    let job = w.sc.jobs.get(ref)!;
    expect(job).toMatchObject({ workerId: 'w1', startAt: '2026-11-03T10:00:00+08:00', endAt: '2026-11-03T11:30:00+08:00', status: 'SCHEDULED' });
    expect(w.sc.sites.get(job.siteRef)).toMatchObject({ name: 'Acme', address: '1 Tuas Ave 8' });
    expect(w.linkOf(run.id)).toMatchObject({ syncState: 'SYNCED', lastPushedStatus: 'SCHEDULED', workerName: 'Ali', durationMin: 90 });

    run.scheduledFor = new Date('2026-11-04T01:00:00Z');
    await w.svc.onScheduleSaved(WCT, run.id, undefined); // the form sent no SiteClock fields: pick kept, time moves
    await w.settle();
    expect(w.sc.jobs.get(ref)).toMatchObject({ workerId: 'w1', startAt: '2026-11-04T09:00:00+08:00' });

    await w.svc.onScheduleSaved(WCT, run.id, { workerId: 'w2', workerName: 'Ben' });
    await w.settle();
    expect(w.sc.jobs.get(ref)!.workerId).toBe('w2');
    expect(w.linkOf(run.id).durationMin).toBe(90); // duration not re-sent → kept

    Object.assign(run, { status: 'in_progress', startedAt: new Date('2026-11-04T01:05:00Z') });
    await w.svc.touch(WCT, run.id);
    await w.settle();
    job = w.sc.jobs.get(ref)!;
    expect(job).toMatchObject({ status: 'IN_PROGRESS', startedAt: '2026-11-04T09:05:00+08:00' });

    Object.assign(run, { status: 'completed', completedAt: new Date('2026-11-04T02:00:00Z') });
    await w.svc.touch(WCT, run.id);
    await w.settle();
    expect(w.sc.jobs.get(ref)).toMatchObject({ status: 'COMPLETED', completedAt: '2026-11-04T10:00:00+08:00' });
    expect(w.linkOf(run.id)).toMatchObject({ syncState: 'SYNCED', lastPushedStatus: 'COMPLETED' });
  });

  it('a draft gets no job until it is promoted', async () => {
    const w = world();
    const run = w.addRun({ isDraft: true, scheduledFor: null });
    await w.svc.onScheduleSaved(WCT, run.id, { workerId: 'w1', workerName: 'Ali' });
    await w.settle();
    expect(w.sc.jobs.size).toBe(0);
    expect(w.linkOf(run.id).syncState).toBe('SYNCED');
    Object.assign(run, { isDraft: false, scheduledFor: new Date('2026-11-03T02:00:00Z') });
    await w.svc.onScheduleSaved(WCT, run.id, undefined);
    await w.settle();
    expect(w.sc.jobs.size).toBe(1);
  });

  it('cancel and delete cancel the job; worker cleared then re-set makes a new job', async () => {
    const w = world();
    const a = w.addRun();
    const b = w.addRun();
    const c = w.addRun();
    for (const r of [a, b, c]) await w.svc.onScheduleSaved(WCT, r.id, { workerId: 'w1', workerName: 'Ali' });
    await w.settle();
    a.status = 'cancelled';
    await w.svc.touch(WCT, a.id);
    w.prisma.delivery.rows.splice(w.prisma.delivery.rows.indexOf(b), 1); // deleted run
    await w.svc.touch(WCT, b.id);
    await w.svc.onScheduleSaved(WCT, c.id, { workerId: null });
    await w.settle();
    expect(w.sc.jobs.get(`aims-delivery:${a.id}`)).toMatchObject({ status: 'CANCELLED', cancelReason: 'Delivery cancelled in AIMS' });
    expect(w.sc.jobs.get(`aims-delivery:${b.id}`)).toMatchObject({ status: 'CANCELLED', cancelReason: 'Delivery deleted in AIMS' });
    expect(w.sc.jobs.get(`aims-delivery:${c.id}`)).toMatchObject({ status: 'CANCELLED', cancelReason: 'Worker removed in AIMS' });
    expect(w.linkOf(c.id)).toMatchObject({ workerId: null, workerName: null, lastPushedStatus: 'CANCELLED' });

    await w.svc.onScheduleSaved(WCT, c.id, { workerId: 'w2', workerName: 'Ben' });
    await w.settle();
    expect(w.sc.jobs.get(`aims-delivery:${c.id}:2`)).toMatchObject({ workerId: 'w2', status: 'SCHEDULED' });
    expect(w.linkOf(c.id)).toMatchObject({ generation: 2, externalRef: `aims-delivery:${c.id}:2`, lastPushedStatus: 'SCHEDULED' });
  });

  it('SiteClock down: FAILED with backoff, one office bell after 3 tries, then recovers', async () => {
    const w = world();
    const run = w.addRun();
    w.sc.down = true;
    await w.svc.onScheduleSaved(WCT, run.id, { workerId: 'w1', workerName: 'Ali' });
    await w.settle();
    let l = w.linkOf(run.id);
    expect(l).toMatchObject({ syncState: 'FAILED', attempts: 1 });
    expect(l.lastError).toMatch(/unreachable/);
    expect(l.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
    await w.svc.syncLink(l.id);
    await w.svc.syncLink(l.id);
    await w.svc.syncLink(l.id);
    expect(w.linkOf(run.id).attempts).toBe(4);
    expect(w.bells).toHaveLength(1);
    expect(w.bells[0]).toMatchObject({ organizationId: WCT, kind: 'SITECLOCK_SYNC_FAILED', linkUrl: `/portal/deliveries/${run.id}` });
    w.sc.down = false;
    const r = await w.svc.retry(WCT, run.id);
    expect(r.ok).toBe(true);
    l = w.linkOf(run.id);
    expect(l).toMatchObject({ syncState: 'SYNCED', attempts: 0, lastError: null, alertedAt: null });
    expect(w.logs.some((x) => x[0] === 'siteclock-sync' && x[1] === 'FAIL')).toBe(true);
    expect(w.logs.some((x) => x[0] === 'siteclock-sync' && x[1] === 'SYNC')).toBe(true);
  });

  it('an address SiteClock cannot find is shown on the run', async () => {
    const w = world();
    const run = w.addRun({ siteAddress: 'Nowhere Lane' });
    await w.svc.onScheduleSaved(WCT, run.id, { workerId: 'w1' });
    await w.settle();
    expect(w.linkOf(run.id)).toMatchObject({ syncState: 'FAILED' });
    expect(w.linkOf(run.id).lastError).toMatch(/not on the map/);
  });

  it('learns a job cancelled on the SiteClock side and makes a new one', async () => {
    const w = world();
    const run = w.addRun();
    await w.svc.onScheduleSaved(WCT, run.id, { workerId: 'w1' });
    await w.settle();
    w.sc.jobs.get(`aims-delivery:${run.id}`)!.status = 'CANCELLED';
    run.scheduledFor = new Date('2026-11-05T02:00:00Z');
    await w.svc.onScheduleSaved(WCT, run.id, undefined);
    await w.settle();
    expect(w.sc.jobs.get(`aims-delivery:${run.id}:2`)).toMatchObject({ status: 'SCHEDULED', startAt: '2026-11-05T10:00:00+08:00' });
    expect(w.linkOf(run.id).syncState).toBe('SYNCED');
  });

  it('the minute sweep catches a run that moved on without a hook', async () => {
    const w = world();
    const run = w.addRun();
    await w.svc.onScheduleSaved(WCT, run.id, { workerId: 'w1' });
    await w.settle();
    run.status = 'delivered'; // e.g. the documents-side fold
    await w.svc.sweep();
    expect(w.sc.jobs.get(`aims-delivery:${run.id}`)!.status).toBe('IN_PROGRESS');
  });

  it('workers come grouped by team; the key is stored sealed and never returned', async () => {
    const w = world();
    const data = await w.svc.workers(WCT);
    expect(data.teams).toEqual([{ id: 't1', name: 'Team A', workers: [{ id: 'w1', name: 'Ali', employeeNo: 'E1' }] }]);
    expect(data.others).toEqual([{ id: 'w2', name: 'Ben', employeeNo: null }]);
    const conn = await w.svc.getConnection(WCT);
    expect(JSON.stringify(conn)).not.toContain(KEY);
    expect(conn).toMatchObject({ connected: true, apiKeyLast4: KEY.slice(-4) });
    expect(w.prisma.siteClockConnection.rows[0].apiKeyEnc).not.toContain(KEY);
    await expect(w.svc.workers(OTHER)).rejects.toThrow(/not linked/);
  });

  it('saveConnection validates and seals a new key', async () => {
    const w = world();
    await expect(w.svc.saveConnection(OTHER, { baseUrl: 'ftp://x', siteclockCompanyId: 'c', apiKey: KEY })).rejects.toThrow(/Base URL/);
    await expect(w.svc.saveConnection(OTHER, { baseUrl: 'https://sc', siteclockCompanyId: 'c', apiKey: 'nope' })).rejects.toThrow(/SiteClock API key/);
    const c = await w.svc.saveConnection(OTHER, { baseUrl: 'https://sc/', siteclockCompanyId: 'c', apiKey: 'sck_live_' + 'z'.repeat(20) });
    expect(c).toMatchObject({ connected: true, baseUrl: 'https://sc', enabled: false, apiKeyLast4: 'zzzz' });
    // flag still off for OTHER → still not linked even after enabling
    await w.svc.saveConnection(OTHER, { enabled: true });
    expect(await w.svc.isLinked(OTHER)).toBe(false);
  });

  it('a key pasted with the key file\'s SITECLOCK_API_KEY= prefix, quotes or spaces is accepted', async () => {
    const k = 'sck_live_' + 'Ab9_'.repeat(6);
    expect(normaliseApiKey(`SITECLOCK_API_KEY=${k}`)).toBe(k);
    expect(normaliseApiKey(`  "${k}"\n`)).toBe(k);
    expect(normaliseApiKey(undefined)).toBe('');
    const w = world();
    const c = await w.svc.saveConnection(OTHER, { baseUrl: 'https://sc', siteclockCompanyId: 'c', apiKey: ` SITECLOCK_API_KEY=${k} ` });
    expect(c).toMatchObject({ connected: true, apiKeyLast4: k.slice(-4) });
  });

  it('a rejected save says why (the portal shows this message, not "saved")', async () => {
    const w = world();
    await expect(w.svc.saveConnection(OTHER, { baseUrl: 'https://sc', siteclockCompanyId: '', apiKey: KEY })).rejects.toThrow('SiteClock company id is required');
    expect(w.prisma.siteClockConnection.rows.filter((r: any) => r.organizationId === OTHER)).toHaveLength(0);
  });
});
