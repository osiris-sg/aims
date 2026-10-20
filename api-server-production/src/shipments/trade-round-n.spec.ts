/**
 * Round N — fixes from the live click-through (#28 SUS 2 shipments, #29 Kato): multi-shipment progress, search by
 * order no., quantity tolerance, test orders, the Kato (Nagoya) 倉庫名, the provisional PI price check, and Undo on an
 * imported, completed shipment.
 */
import { progressBar, barLabel } from './trade-dashboard';
import { orderCurrentStep, stepsBrokenByRemoval, toleranceOf } from './shipments.rules';
import { OrdersService, rankByOrderNo } from './orders.service';
import { isTestRecord, onlyTestLinks, testRecordIds } from './trade-test-orders';
import { siWarehouse } from './trade-generated.service';
import { priceCheck } from './trade-contract';
import { TradeFilesService } from './trade-files.service';
import { TradeConfigService } from './trade-config.service';

const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42';
let n = 0;
const st = (code: string, displayNo: string, status: 'DONE' | 'IN_PROGRESS' | 'NOT_STARTED', o: { na?: boolean; ongoing?: boolean; title?: string } = {}) => ({
  code,
  title: o.title ?? code,
  displayNo,
  sortOrder: n++,
  status,
  isOngoing: !!o.ongoing,
  notApplicable: !!o.na,
});
const SHIP = ['3a', '3b', '4', '5', '6', '7', '8', '9', '10', '12'];
const shipSteps = (done: string[], inProgress: string[] = []) =>
  SHIP.map((no) => st(`S${no}`, no, done.includes(no) ? 'DONE' : inProgress.includes(no) ? 'IN_PROGRESS' : 'NOT_STARTED', { title: no === '1' ? 'Set up PI payment' : `Step ${no}` }));

describe('#8 multi-shipment progress (#28: #28-1 has 3a+3b done, #28-2 has 3a done)', () => {
  const order = [
    st('CHECK_CONTRACT', '0', 'DONE'),
    st('PI_PAYMENT', '1', 'IN_PROGRESS', { title: 'Set up PI payment' }),
    st('INVOICE_1', '2', 'NOT_STARTED'),
    st('INVOICE_2', '11', 'NOT_STARTED'),
    st('XERO_HANDOFF', '13', 'NOT_STARTED'),
  ];
  const s1 = { status: 'OPEN', steps: shipSteps(['3a', '3b'], ['4']) };
  const s2 = { status: 'OPEN', steps: shipSteps(['3a'], ['3b']) };
  const bar = progressBar([...order.map((x) => ({ ...x, recordId: 'o' })), ...s1.steps.map((x) => ({ ...x, recordId: 's1' })), ...s2.steps.map((x) => ({ ...x, recordId: 's2' }))], new Set());
  it('a shipment step counts as done only when done on ALL shipments; done on some = partial', () => {
    expect(bar).toMatchObject({ done: 2, total: 15, partial: 1 }); // 0 + 3a done; 3b partial
    expect(bar.segments.find((x) => x.no === '3b')).toMatchObject({ partial: true });
  });
  it('the label names the furthest-behind open step across the order and ALL shipments; no "of N"', () => {
    const cur = orderCurrentStep(null, order as any, [s1, s2] as any);
    expect(cur?.displayNo).toBe('1');
    expect(barLabel(cur, bar.done, bar.total).label).toBe('Step 1 · PI payment');
    // Without the order's own open step 1: #28-2's 3b is behind #28-1's 4.
    const later = orderCurrentStep(null, order.map((x) => (x.displayNo === '1' ? { ...x, status: 'DONE' } : x)) as any, [s1, s2] as any);
    expect(later?.displayNo).toBe('2');
    const shipOnly = orderCurrentStep(null, [] as any, [s1, s2] as any);
    expect(shipOnly?.displayNo).toBe('3b');
  });
});

describe('#9 order page: the same whole-process count as the list', () => {
  it('getById returns bar x/15 for #28 (not the order-only 1/5)', async () => {
    const order = [
      st('CHECK_CONTRACT', '0', 'DONE'),
      st('PI_PAYMENT', '1', 'IN_PROGRESS'),
      st('INVOICE_1', '2', 'NOT_STARTED'),
      st('INVOICE_2', '11', 'NOT_STARTED'),
      st('XERO_HANDOFF', '13', 'NOT_STARTED'),
    ];
    const prisma: any = { tradeAlert: { findMany: jest.fn().mockResolvedValue([]) }, tradeStepTemplate: { findMany: jest.fn().mockResolvedValue([]) } };
    const svc = new OrdersService(prisma, {} as any, {} as any);
    const bars = await svc.orderBars(ORG, [
      {
        id: 'o28',
        customerId: 'c',
        supplierId: 's',
        steps: order,
        shipments: [
          { id: 's1', status: 'OPEN', steps: shipSteps(['3a', '3b']) },
          { id: 's2', status: 'OPEN', steps: shipSteps(['3a']) },
        ],
      },
    ]);
    expect(bars.get('o28')!.bar).toMatchObject({ done: 2, total: 15 });
    expect(bars.get('o28')!.shipments.get('s1')).toMatchObject({ done: 2, total: 10 });
  });
});

describe('#10 search "28": the order number first', () => {
  it('exact order no. first, then the other matches in list order', () => {
    const rows = [{ orderNo: 17 }, { orderNo: 15 }, { orderNo: 28 }];
    expect(rankByOrderNo(rows, 28).map((r) => r.orderNo)).toEqual([28, 17, 15]);
    expect(rankByOrderNo(rows, 99).map((r) => r.orderNo)).toEqual([17, 15, 28]);
  });
  it('the list fetches unpaged for a number query and ranks it', async () => {
    const mk = (id: string, orderNo: number) => ({
      id,
      year: 2026,
      orderNo,
      shipMonth: '2026-07',
      deliveryMonth: null,
      status: 'OPEN',
      customerId: 'c',
      supplierId: 's',
      customer: null,
      supplier: null,
      contract: null,
      steps: [],
      shipments: [],
    });
    const prisma: any = {
      tradeOrder: { findMany: jest.fn().mockResolvedValue([mk('a', 17), mk('b', 15), mk('c', 28)]), count: jest.fn().mockResolvedValue(3), groupBy: jest.fn().mockResolvedValue([]) },
      tradeAlert: { findMany: jest.fn().mockResolvedValue([]) },
      tradeStepTemplate: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const r: any = await new OrdersService(prisma, {} as any, {} as any).list(ORG, { q: '28', pageSize: '20' } as any);
    expect(r.items.map((x: any) => x.label)).toEqual(['#28', '#17', '#15']);
    expect(prisma.tradeOrder.findMany.mock.calls[0][0].skip).toBeUndefined();
    // And test orders are left out unless asked for.
    expect(prisma.tradeOrder.findMany.mock.calls[0][0].where).toMatchObject({ isTest: false });
  });
});

describe('#13 tolerance', () => {
  it('#28: 300 MT ±5% with B/Ls totalling 346.579 MT → over (max 315)', () => {
    const t = toleranceOf(300, 5, [305.804, 40.775])!;
    expect(t).toMatchObject({ status: 'over', max: 315, netTotal: 346.579 });
    expect(t.message).toMatch(/346\.579 MT net — over the order's 300 MT ±5% \(max 315 MT\) by 31\.579 MT/);
  });
  it('within / no weights yet / no quantity', () => {
    expect(toleranceOf(40, 5, [40.1])!.status).toBe('within');
    expect(toleranceOf(300, 5, [null, undefined])!.status).toBe('unknown');
    expect(toleranceOf(null, 5, [1])).toBeNull();
    // Under the minimum is not flagged (more shipments may come).
    expect(toleranceOf(300, 5, [100])!.status).toBe('within');
  });
});

describe('#19 test orders', () => {
  it('test ids, records and documents that belong only to test orders', async () => {
    const db: any = { tradeOrder: { findMany: jest.fn().mockResolvedValue([{ id: 'o28', shipments: [{ id: 's28-1' }] }]) } };
    const ids = await testRecordIds(db, ORG);
    expect(isTestRecord(ids, { orderId: 'o28' })).toBe(true);
    expect(isTestRecord(ids, { shipmentId: 's28-1' })).toBe(true);
    expect(isTestRecord(ids, { orderId: 'o15' })).toBe(false);
    expect(onlyTestLinks(ids, [{ shipmentId: 's28-1' }])).toBe(true);
    expect(onlyTestLinks(ids, [{ shipmentId: 's28-1' }, { orderId: 'o15' }])).toBe(false);
    expect(onlyTestLinks(ids, [])).toBe(false);
  });
});

describe('#17 出庫・納入依頼書 倉庫名', () => {
  it("Kato (Nagoya): blank + check, never the Yokohama default; the site's own 倉庫名 wins; Yokohama keeps the default", () => {
    expect(siWarehouse({ warehouseCheck: true }, 'Nagoya', '三井倉庫/本牧A倉庫')).toEqual({ warehouseName: '', warehouseCheck: true });
    expect(siWarehouse(null, 'Nagoya', '三井倉庫/本牧A倉庫')).toEqual({ warehouseName: '', warehouseCheck: true });
    expect(siWarehouse({ warehouseName: '三井倉庫/名古屋X' }, 'Nagoya', '三井倉庫/本牧A倉庫')).toEqual({ warehouseName: '三井倉庫/名古屋X' });
    expect(siWarehouse(null, 'Yokohama', '三井倉庫/本牧A倉庫')).toEqual({ warehouseName: '三井倉庫/本牧A倉庫' });
  });
});

describe('#14 PI price check: LME is provisional', () => {
  const prices = { lmeByMonth: { '2026-06': 3458.64 }, qmjpByQuarter: {} } as any;
  it('a PI LME +16.81 is amber "provisional", the check still passes; a wrong premium stays red', () => {
    const ok = priceCheck({
      side: 'supplier',
      basisMonth: '2026-06',
      schedule: [],
      fallback: { supplierPremium: 556.5 },
      prices,
      found: { lme: 3475.45, premium: 556.5, unit: 4031.95 },
      provisional: true,
    });
    expect(ok.lines.find((l) => l.key === 'lme')).toMatchObject({ mark: 'provisional', diff: 16.81 });
    expect(ok.ok).toBe(true);
    expect(ok.notes.join(' ')).toMatch(/provisional/);
    const bad = priceCheck({
      side: 'supplier',
      basisMonth: '2026-06',
      schedule: [],
      fallback: { supplierPremium: 556.5 },
      prices,
      found: { lme: 3475.45, premium: 560, unit: 4035.45 },
      provisional: true,
    });
    expect(bad.lines.find((l) => l.key === 'premium')!.mark).toBe('diff');
    expect(bad.ok).toBe(false);
    // A CI is not provisional: the same LME gap is an error there.
    expect(priceCheck({ side: 'supplier', basisMonth: '2026-06', schedule: [], fallback: { supplierPremium: 556.5 }, prices, found: { lme: 3475.45 } }).lines.find((l) => l.key === 'lme')!.mark).toBe(
      'diff',
    );
  });
});

describe('#5 Undo on an imported, completed shipment', () => {
  const imported = [
    { id: 's3a', title: 'Approve B/L draft', status: 'DONE', isOngoing: false, requiredDocTypes: ['BL_DRAFT'] },
    { id: 's4', title: 'Create customer documents', status: 'DONE', isOngoing: false, requiredDocTypes: ['CUSTOMER_PL', 'CUSTOMER_COA'] },
  ];
  it('only the types being removed count — a DELIVERY_NOTE breaks no imported step', () => {
    expect(stepsBrokenByRemoval(imported as any, [], ['DELIVERY_NOTE'])).toEqual([]);
    // Without "before" (old behaviour) every imported step looked broken.
    expect(stepsBrokenByRemoval(imported as any, []).length).toBe(2);
    // Removing the last BL_DRAFT of a step that had it still blocks.
    expect(stepsBrokenByRemoval(imported as any, [], ['BL_DRAFT']).map((b) => b.step.id)).toEqual(['s3a']);
  });
  it("the email's Undo removes its delivery note from #15-1 (completed, imported) — the guard lets it through", async () => {
    const prisma: any = {
      tradeFile: {
        findFirst: jest.fn().mockResolvedValue({
          s3Key: 'k',
          thumbKey: null,
          links: [
            {
              contractId: null,
              shipmentId: 'sh15-1',
              orderId: null,
              supplierOrderId: null,
              contract: null,
              shipment: { blNumber: '198GX05383', status: 'COMPLETED' },
              order: null,
              supplierOrder: null,
            },
          ],
        }),
        delete: jest.fn().mockResolvedValue({}),
      },
      tradeStep: { findMany: jest.fn().mockResolvedValue(imported) },
      tradeFileLink: { findMany: jest.fn(async ({ where }: any) => (where?.NOT ? [] : [{ file: { docType: 'DELIVERY_NOTE' } }])) },
      tradeDocumentLink: { findMany: jest.fn().mockResolvedValue([]) },
      document: { findMany: jest.fn().mockResolvedValue([]) },
      tradeDocType: { findMany: jest.fn().mockResolvedValue([]) },
    };
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));
    const files = new TradeFilesService(prisma, { deleteFile: jest.fn() } as any, new TradeConfigService(prisma), { removeObject: jest.fn(), make: jest.fn() } as any);
    await expect(files.remove(ORG, 'f1')).rejects.toThrow(/is completed — reopen it first/);
    await files.remove(ORG, 'f1', { allowClosed: true });
    expect(prisma.tradeFile.delete).toHaveBeenCalledWith({ where: { id: 'f1', organizationId: ORG } });
  });
});
