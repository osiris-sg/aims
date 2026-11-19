import { DocumentNumberingService, ORDER_PREFIX_KEY, orderNumberPrefixOf, seriesResetKey, validOrderPrefix } from '../document-numbering/document-numbering.service';
import { issueOrderNumberInTx } from './wct-orders';
import { OrdersService } from './orders.service';

/**
 * Round 36 (WCT group, 2026-11-19), item 6: company order numbers. The org setting features.orderNumberPrefix
 * (ORDW / ORDR / ORDY / ORDB) replaces ORD in new AIMS order numbers, as its own series on the org's ORDER counter;
 * every other org keeps ORD… exactly as before. The real-Postgres run (two orders at once) is in
 * document-numbering/locked-number.db.spec.ts.
 */
const ORG = 'org-wct';
const now = new Date(2026, 10, 19);

/** An in-memory ORDER counter row + orders, enough for issueNumberLocked. */
function world(features: any, opts: { nextSerial?: number; lastResetKey?: string | null; pattern?: string; orders?: string[] } = {}) {
  const f: any = { id: 'f1', organizationId: ORG, documentType: 'ORDER', pattern: opts.pattern ?? '{DOC}{YYYY}{MM}-{###}', nextSerial: opts.nextSerial ?? 19, resetPolicy: 'never', lastResetKey: opts.lastResetKey ?? null, isActive: true };
  const orders = [...(opts.orders ?? ['ORD202611-018', 'ORD-Q-014154'])];
  const db: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features })) },
    documentNumberFormat: {
      findFirst: jest.fn(async () => f),
      findMany: jest.fn(async () => [f]),
      update: jest.fn(async ({ data }: any) => {
        if (data.nextSerial && typeof data.nextSerial === 'number') f.nextSerial = data.nextSerial;
        if (data.lastResetKey !== undefined) f.lastResetKey = data.lastResetKey;
        return f;
      }),
    },
    order: { findMany: jest.fn(async ({ where }: any) => orders.filter((n) => n.startsWith(where.orderNumber.startsWith)).map((orderNumber) => ({ orderNumber }))) },
    document: { findMany: jest.fn(async () => []) },
  };
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  return { db, f, orders };
}

describe('company order prefix (org setting)', () => {
  it('validOrderPrefix: letters and digits, starting with a letter, 2 to 10; never ORD-Q- style', () => {
    expect(['ORDW', 'ORDR', 'ORDY', 'ORDB', ' ORDW '].map(validOrderPrefix)).toEqual(['ORDW', 'ORDR', 'ORDY', 'ORDB', 'ORDW']);
    expect(['ORD-Q', 'O', '', '1ORD', 'ORD W', 'ORDWXXXXXXXX', null, 7].map(validOrderPrefix)).toEqual([null, null, null, null, null, null, null, null]);
  });
  it('orderNumberPrefixOf: the features key; absent / invalid / unreadable = none (ORD)', async () => {
    expect(ORDER_PREFIX_KEY).toBe('orderNumberPrefix');
    expect(await orderNumberPrefixOf(world({ orderNumberPrefix: 'ORDW' }).db, ORG)).toBe('ORDW');
    expect(await orderNumberPrefixOf(world({}).db, ORG)).toBeNull();
    expect(await orderNumberPrefixOf(world({ orderNumberPrefix: 'ORD-Q' }).db, ORG)).toBeNull();
    expect(await orderNumberPrefixOf({} as any, ORG)).toBeNull();
  });
  it('seriesResetKey: no series = the policy key as before; a series is its own key', () => {
    expect(seriesResetKey(null)).toBeNull();
    expect(seriesResetKey('2026-11')).toBe('2026-11');
    expect(seriesResetKey(null, 'ORDW')).toBe('never#ORDW');
    expect(seriesResetKey('2026-11', 'ORDW')).toBe('2026-11#ORDW');
  });
});

describe('issueOrderNumberInTx', () => {
  it('WCT (S) with ORDW: the new series starts at 001 (old ORD… 018 and ORD-Q-… never count), then continues', async () => {
    const { db, f } = world({ orderNumberPrefix: 'ORDW' });
    expect(await issueOrderNumberInTx(db, db, ORG, 'f1', now)).toBe('ORDW202611-001');
    expect(f).toMatchObject({ nextSerial: 2, lastResetKey: 'never#ORDW' });
    expect(await issueOrderNumberInTx(db, db, ORG, 'f1', now)).toBe('ORDW202611-002');
    // The highest existing number with the prefix is respected (an order typed in by a script, say).
    const typed = world({ orderNumberPrefix: 'ORDW' }, { orders: ['ORDW202611-007'] });
    expect(await issueOrderNumberInTx(typed.db, typed.db, ORG, 'f1', now)).toBe('ORDW202611-008');
  });
  it('Racking keeps its pattern around the prefix (WR-{DOC}… reads WR-ORDR…)', async () => {
    const { db } = world({ orderNumberPrefix: 'ORDR' }, { pattern: 'WR-{DOC}{YYYY}{MM}-{###}', nextSerial: 2, orders: ['WR-ORD202611-001'] });
    expect(await issueOrderNumberInTx(db, db, ORG, 'f1', now)).toBe('WR-ORDR202611-001');
  });
  it('every other org: ORD…, the counter as before, lastResetKey untouched', async () => {
    const { db, f } = world({ enableWctOrders: true });
    expect(await issueOrderNumberInTx(db, db, ORG, 'f1', now)).toBe('ORD202611-019');
    expect(f).toMatchObject({ nextSerial: 20, lastResetKey: null });
  });
});

describe('Document Numbering list: the ORDER preview with the prefix', () => {
  it('prefixed org: preview ORDW202611-001 and docCode for the editor; other orgs: no docCode key, ORD preview', async () => {
    const w = world({ orderNumberPrefix: 'ORDW' });
    const [row] = await new DocumentNumberingService(w.db).list(ORG);
    expect(row.preview).toMatch(/^ORDW\d{6}-001$/);
    expect((row as any).docCode).toBe('ORDW');
    const o = world({});
    const [plain] = await new DocumentNumberingService(o.db).list(ORG);
    expect(plain.preview).toMatch(/^ORD\d{6}-\d{3}$/);
    expect('docCode' in plain).toBe(false);
  });
});

describe('createFromQuotation (generic quotation to order)', () => {
  function svc(features: any) {
    const w = world(features);
    const created: any[] = [];
    w.db.order.findFirst = jest.fn(async () => null);
    w.db.order.create = jest.fn(async ({ data }: any) => (created.push(data), { id: 'o1', ...data }));
    w.db.document = { findFirst: jest.fn(async () => ({ id: 'q1', name: 'QO202611-0049', config: { items: [] } })), findMany: jest.fn(async () => []) };
    w.db.asset = { findMany: jest.fn(async () => []) };
    const s: any = Object.create(OrdersService.prototype);
    s.prisma = w.db;
    return { s, created, db: w.db };
  }
  it('an org with the prefix: numbered from its ORDER counter in the transaction (ORDW…)', async () => {
    const { s, created, db } = svc({ orderNumberPrefix: 'ORDW' });
    await s.createFromQuotation('q1', ORG);
    expect(created[0].orderNumber).toMatch(/^ORDW\d{6}-001$/);
    expect(db.$transaction).toHaveBeenCalled();
  });
  it('every other org: the old ORD{YYYY}{MM}-NNN, no transaction (unchanged)', async () => {
    const { s, created, db } = svc({ enableConfirmQuotation: true });
    db.order.findFirst = jest.fn(async (args: any) => (args?.orderBy ? { orderNumber: 'ORD202611-004' } : null));
    await s.createFromQuotation('q1', ORG);
    expect(created[0].orderNumber).toMatch(/^ORD\d{6}-\d{3}$/);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
