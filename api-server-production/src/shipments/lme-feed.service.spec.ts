/** Round AK — LME feed service: flag gate (nothing written while off), typed months untouched, revise tasks, price check. */
import * as fs from 'fs';
import * as path from 'path';
import { LmeFeedService } from './lme-feed.service';
import { priceCheck } from './trade-contract';
import { STANDING_KINDS } from './trade-alerts';

const fx = (f: string) => fs.readFileSync(path.join(__dirname, '__fixtures__', f), 'utf8');
const ADH = 'adh';
const OTHER = 'other';

function makePrisma(opts: { flag: boolean; table: Record<string, number>; docs?: any[]; ships?: any[]; ci?: any }) {
  const writes: Array<[string, string, any]> = [];
  let docDefaults: any = { lmeByMonth: { ...opts.table }, banks: [] };
  const w = (model: string, op: string) => async (args: any) => {
    writes.push([model, op, args]);
    if (model === 'tradeSetting' && op === 'update') docDefaults = args.data.docDefaults;
    return {};
  };
  const prisma: any = {
    lmeQuote: { findMany: async () => [], upsert: w('lmeQuote', 'upsert') },
    lmeMonthly: { findMany: async () => [], upsert: w('lmeMonthly', 'upsert') },
    lmeFetchRun: { create: w('lmeFetchRun', 'create'), findFirst: async () => null },
    organizationModule: { findMany: async (a: any) => [{ organizationId: ADH }].filter((r) => !a.where.organizationId || a.where.organizationId === r.organizationId) },
    organizationUIConfig: { findMany: async () => [{ organizationId: ADH, features: { enableLmeFeed: opts.flag } }] },
    tradeSetting: { findUnique: async () => ({ docDefaults }), update: w('tradeSetting', 'update') },
    tradeGeneratedDoc: { findMany: async (a: any) => (opts.docs ?? []).filter((d) => d.header.lmeMonth === a.where.header.equals) },
    shipment: { findMany: async (a: any) => (opts.ships ?? []).filter((s) => s.shipMonth === a.where.order.shipMonth) },
    tradeExtraction: { findFirst: async () => opts.ci ?? null },
    tradeAlert: { findMany: async () => [], create: w('tradeAlert', 'create') },
    $transaction: async (fn: any) => fn(prisma),
  };
  return { prisma, writes, get docDefaults() { return docDefaults; } };
}

const actionLog: any = { system: jest.fn() };
beforeAll(() => {
  (global as any).fetch = jest.fn(async (url: string) => ({ ok: true, status: 200, text: async () => fx(/averages/.test(url) ? 'westmetall-al-averages-2026-10-25.html' : 'westmetall-al-daily-2026-10-25.html') }));
  jest.spyOn(global, 'setTimeout').mockImplementation(((fn: any) => { fn(); return 0 as any; }) as any);
});
afterAll(() => jest.restoreAllMocks());
const NOW = new Date('2026-10-25T22:00:00Z');

describe('LmeFeedService', () => {
  it('flag off: reads and plans, writes nothing anywhere (even when asked to apply)', async () => {
    const m = makePrisma({ flag: false, table: { '2026-06': 3458.64, '2026-07': 3155.98 } });
    const r = await new LmeFeedService(m.prisma, actionLog).run('MANUAL', { apply: true, now: NOW });
    expect(r.apply).toBe(false);
    expect(m.writes).toEqual([]);
    expect(r.orgs[0].plan.writes.map((w) => w.month)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-08', '2026-09', '2026-10']);
    expect(r.orgs[0].plan.agree).toEqual(['2026-06', '2026-07']);
    expect(r.publishedMismatch).toEqual([]);
  });

  it('flag on: fills empty months, marks them as the feed’s, leaves a typed month that differs', async () => {
    const m = makePrisma({ flag: true, table: { '2026-06': 3458.64, '2026-07': 3150 } });
    const r = await new LmeFeedService(m.prisma, actionLog).run('CRON', { apply: true, now: NOW });
    expect(r.apply).toBe(true);
    expect(m.docDefaults.lmeByMonth).toMatchObject({ '2026-06': 3458.64, '2026-07': 3150, '2026-08': 3249.63, '2026-09': 3276.82, '2026-10': 3054.88 });
    expect(m.docDefaults.lmeAuto['2026-10']).toMatchObject({ value: 3054.88, final: false, days: 17 });
    expect(m.docDefaults.lmeAuto['2026-07']).toBeUndefined();
    expect(m.docDefaults.banks).toEqual([]); // other settings kept
    expect(r.orgs[0].plan.conflicts).toEqual([{ month: '2026-07', table: 3150, westmetall: 3155.98, final: true }]);
    expect(m.writes.filter(([t]) => t === 'lmeFetchRun')).toHaveLength(1);
  });

  it('only SHIPMENTS orgs are touched', async () => {
    const m = makePrisma({ flag: true, table: {} });
    const r = await new LmeFeedService(m.prisma, actionLog).run('CRON', { apply: true, now: NOW, onlyOrg: OTHER });
    expect(r.orgs).toEqual([]);
    expect(m.writes.filter(([t]) => t === 'tradeSetting')).toEqual([]);
  });

  it('a month turning final raises one revise task per open priced document / CI that used another LME', async () => {
    const docs = [
      { id: 'g1', docType: 'SGJP_IV_PL', number: 'ADH20261101', status: 'FINAL', header: { lmeMonth: '2026-09' }, rows: [{ lme: 3250 }], orderId: null, shipmentId: 's1', order: null, shipment: { seqNo: 2, status: 'OPEN', orderId: 'o19', order: { orderNo: 19, status: 'OPEN', isTest: false } } },
      { id: 'g2', docType: 'INVOICE_2', number: null, status: 'DRAFT', header: { lmeMonth: '2026-09' }, rows: [{ lme: 3276.82 }], orderId: null, shipmentId: 's1', order: null, shipment: { seqNo: 2, status: 'OPEN', orderId: 'o19', order: { orderNo: 19, status: 'OPEN', isTest: false } } },
      { id: 'g3', docType: 'INVOICE_2', number: null, status: 'FINAL', header: { lmeMonth: '2026-09' }, rows: [{ lme: 3200 }], orderId: null, shipmentId: 's9', order: null, shipment: { seqNo: 1, status: 'COMPLETED', orderId: 'o9', order: { orderNo: 9, status: 'COMPLETED', isTest: false } } },
    ];
    const ships = [{ id: 's1', seqNo: 2, ciNumber: 'XP26521000123', orderId: 'o19', order: { orderNo: 19 }, shipMonth: '2026-09', fileLinks: [{ fileId: 'f1' }] }];
    const m = makePrisma({ flag: true, table: {}, docs, ships, ci: { fileId: 'f1', result: { raw: { lme: 3240.5 } } } });
    const r = await new LmeFeedService(m.prisma, actionLog).run('CRON', { apply: true, now: NOW });
    const tasks = m.writes.filter(([t]) => t === 'tradeAlert').map(([, , a]) => a.data);
    const sep = tasks.filter((t) => t.key.endsWith(':2026-09'));
    expect(sep.map((t) => t.title)).toEqual(['#19-2: revise SG→JP IV/PL — LME Sep 2026 is final at 3,276.82', '#19-2: ask Vedanta for the revised CI — LME Sep 2026 is final at 3,276.82']);
    expect(sep.every((t) => t.kind === 'LME_REVISE' && t.status === 'DUE' && t.orderId === 'o19')).toBe(true);
    expect(r.newlyFinal).toContain('2026-09');
    expect(STANDING_KINDS.has('LME_REVISE')).toBe(true); // the hourly planner never closes it
  });

  it('a broken page: failed run, nothing else written', async () => {
    (global as any).fetch.mockImplementationOnce(async () => ({ ok: true, status: 200, text: async () => '<html>new layout</html>' }));
    const m = makePrisma({ flag: true, table: {} });
    const r = await new LmeFeedService(m.prisma, actionLog).run('CRON', { apply: true, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Page layout changed/);
    expect(m.writes.map(([t]) => t)).toEqual(['lmeFetchRun']);
    expect(m.writes[0][2].data.ok).toBe(false);
  });
});

describe('price check with a provisional LME month', () => {
  const base = { side: 'client' as const, basisMonth: '2026-10', schedule: [], fallback: { clientPremium: 200 }, found: { lme: 3000, qmjp: 395, premium: 200 } };
  it('a difference against the provisional average is "provisional", not an error', () => {
    const c = priceCheck({ ...base, prices: { lmeByMonth: { '2026-10': 3054.88 }, qmjpByQuarter: { '2026-4Q': 395 }, provisionalMonths: ['2026-10'] } });
    expect(c.lines.find((l) => l.key === 'lme')!.mark).toBe('provisional');
    expect(c.ok).toBe(true);
    expect(c.notes.join(' ')).toMatch(/provisional/);
  });
  it('unchanged for a final / typed month (every other org)', () => {
    const c = priceCheck({ ...base, prices: { lmeByMonth: { '2026-10': 3054.88 }, qmjpByQuarter: { '2026-4Q': 395 } } });
    expect(c.lines.find((l) => l.key === 'lme')!.mark).toBe('diff');
  });
});
