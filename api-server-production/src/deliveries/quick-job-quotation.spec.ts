jest.mock('../delivery-group-posts/enqueue', () => ({ enqueueDeliveryGroupPost: jest.fn(async () => null) }));
jest.mock('../maintenance-reports/wct-brand', () => ({ wctBrandStamp: jest.fn(async () => ({})) }));
// Order numbers and the per-quotation lock are SQL / the numbering service: stubbed (covered elsewhere).
jest.mock('src/orders/wct-orders', () => {
  const actual = jest.requireActual('src/orders/wct-orders');
  let n = 100;
  return {
    ...actual,
    ensureOrderNumberFormat: jest.fn(async () => ({ id: 'fmt' })),
    issueOrderNumberInTx: jest.fn(async () => `ORD202611-${++n}`),
    lockQuotation: jest.fn(async () => undefined),
    refreshOrderStatus: jest.fn(async () => null),
  };
});

import { BadRequestException } from '@nestjs/common';
import { DeliveriesService } from './deliveries.service';
import { quotationIndex } from './quotation-search-index';
import { autoDraftDeliveryFromQuotation } from './quotation-to-delivery';
import {
  isOpenDo,
  isUuid,
  jobRowsFromDo,
  likePattern,
  pendingQuotationJobsWhere,
  pickDoForJob,
  quotationCustomerIdOf,
  quotationSiteOf,
  quotationStatusLabel,
  quotationSubjectOf,
  searchLimit,
} from './quick-job-quotation';

/**
 * WCT jobs calendar "New job" with a Quotation (2026-11-17). Pure helpers, then
 * the service + the quotation-acceptance hook over a small in-memory store:
 * each link case (order + one DO, several DOs, no DO, not signed then signed),
 * and orgs without the gate unchanged.
 */

const ORG = '5c700000-0000-4000-8000-5c7000000001';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CUST = uid(1);
const QO = uid(2);

// ── tiny in-memory Prisma ─────────────────────────────────────────────────
type Row = Record<string, any>;
type Db = Record<string, Row[]>;

function makePrisma(db: Db) {
  let seq = 1000;
  const rel = (table: string, row: Row, key: string): Row[] | Row | null => {
    if (table === 'delivery' && key === 'items') return db.deliveryItem.filter((i) => i.deliveryId === row.id);
    if (table === 'deliveryItem' && key === 'delivery') return db.delivery.find((d) => d.id === row.deliveryId) ?? null;
    return undefined as any;
  };
  const cond = (v: any, c: any): boolean => {
    if (c === null) return v == null;
    if (c && typeof c === 'object' && !Array.isArray(c) && !(c instanceof Date)) {
      if ('in' in c) return c.in.includes(v);
      if ('notIn' in c) return !c.notIn.includes(v);
      if ('not' in c) return c.not === null ? v != null : v !== c.not;
      if ('equals' in c) return v === c.equals;
      if ('startsWith' in c) return String(v ?? '').startsWith(c.startsWith);
    }
    return v === c;
  };
  const match = (table: string, row: Row, where: any): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([k, c]: [string, any]) => {
      if (c === undefined) return true;
      if (k === 'AND') return (c as any[]).every((w) => match(table, row, w));
      if (k === 'OR') return (c as any[]).some((w) => match(table, row, w));
      if (k === 'NOT') return !match(table, row, c);
      if (k === 'config' && c?.path) return cond(c.path.reduce((o: any, p: string) => (o == null ? o : o[p]), row.config), { equals: c.equals });
      const r = rel(table, row, k);
      if (r !== undefined) {
        if (Array.isArray(r)) {
          const sub = table === 'delivery' ? 'deliveryItem' : table;
          if (c.some) return r.some((x) => match(sub, x, c.some));
          if (c.none) return !r.some((x) => match(sub, x, c.none));
          return true;
        }
        return r ? match(table === 'deliveryItem' ? 'delivery' : table, r, c) : false;
      }
      return cond(row[k], c);
    });
  };
  const sortBy = (rows: Row[], orderBy: any) => {
    const o = Array.isArray(orderBy) ? orderBy[0] : orderBy;
    if (!o) return rows;
    const [k, dir] = Object.entries(o)[0] as [string, string];
    return [...rows].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  };
  // Selected relations: the job's items and customer, and _count.items.
  const withCount = (table: string, r: Row, select: any) => {
    if (table !== 'delivery' || !select) return r;
    const items = db.deliveryItem.filter((i) => i.deliveryId === r.id);
    return {
      ...r,
      ...(select._count ? { _count: { items: items.length } } : {}),
      ...(select.items ? { items } : {}),
      ...(select.customer ? { customer: db.customer.find((c) => c.id === r.customerId) ?? null } : {}),
    };
  };
  const model = (table: string) => ({
    findFirst: async ({ where, orderBy, select }: any = {}) => {
      const r = sortBy(db[table].filter((x) => match(table, x, where)), orderBy)[0];
      return r ? withCount(table, r, select) : null;
    },
    findUnique: async ({ where }: any) => db[table].find((x) => match(table, x, where)) ?? null,
    findUniqueOrThrow: async ({ where }: any) => db[table].find((x) => match(table, x, where)),
    findMany: async ({ where, orderBy }: any = {}) => sortBy(db[table].filter((x) => match(table, x, where)), orderBy),
    count: async ({ where }: any = {}) => db[table].filter((x) => match(table, x, where)).length,
    create: async ({ data, select }: any) => {
      const { items, ...rest } = data;
      const row = { id: uid(++seq), createdAt: new Date(Date.now() + seq), status: undefined, ...rest };
      if (table === 'delivery') {
        if (db.delivery.some((d) => d.organizationId === row.organizationId && d.deliveryNumber === row.deliveryNumber)) throw Object.assign(new Error('dup'), { code: 'P2002' });
        row.isDraft = row.isDraft ?? false;
        row.orderId = row.orderId ?? null;
        row.sourceQuotationId = row.sourceQuotationId ?? null;
        for (const it of items?.create ?? []) db.deliveryItem.push({ id: uid(++seq), deliveryId: row.id, documentId: null, ...it });
      }
      db[table].push(row);
      return select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : row;
    },
    createMany: async ({ data }: any) => {
      for (const d of data) db[table].push({ id: uid(++seq), documentId: null, ...d });
      return { count: data.length };
    },
    update: async ({ where, data }: any) => {
      const r = db[table].find((x) => match(table, x, where));
      Object.assign(r!, data);
      return r;
    },
    upsert: async ({ where, update, create }: any) => {
      const w = where.customFieldId_entityId ?? where;
      const r = db[table].find((x) => match(table, x, w));
      if (r) return Object.assign(r, update);
      const row = { id: uid(++seq), ...create };
      db[table].push(row);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const hit = db[table].filter((x) => match(table, x, where));
      hit.forEach((x) => Object.assign(x, data));
      return { count: hit.length };
    },
  });
  const prisma: any = { $queryRaw: jest.fn(async () => []), $executeRawUnsafe: jest.fn(async () => 0) };
  for (const t of Object.keys(db)) prisma[t] = model(t);
  prisma.accountingSetting = { findUnique: async () => null };
  prisma.$transaction = async (fn: any) => fn(prisma);
  return prisma;
}

const GATE = { enableWctOrders: true, enableJobsCalendar: true };
function seed(features: Record<string, boolean>, extra: Partial<Db> = {}): Db {
  return {
    organizationUIConfig: [{ organizationId: ORG, features }],
    customer: [{ id: CUST, organizationId: ORG, name: 'TEST Client', address: '1 Raffles Place, Singapore 048616' }],
    document: [
      {
        id: QO,
        organizationId: ORG,
        type: 'QUOTATION',
        name: 'QO202611-0040',
        status: 'unconfirmed',
        config: { customerId: CUST, customerName: 'TEST Client', subject: 'Chemical degreasing', location: '51 Circular Road', items: [{ description: 'Degreasing', quantity: 1, unitPrice: 500 }] },
      },
    ],
    order: [],
    delivery: [],
    deliveryItem: [],
    maintenanceServiceReport: [],
    ...extra,
  } as Db;
}
const svc = (db: Db) => new DeliveriesService(makePrisma(db), {} as any, {} as any, {} as any, {} as any);
const body = (over: Record<string, any> = {}) => ({ customerId: CUST, siteAddress: '51 Circular Road', scheduledFor: '2026-11-20T02:00:00.000Z', durationMin: 60, remarks: '', ptwStatus: 'NOT_NEEDED', ...over });
const order = (id: string) => ({ id, organizationId: ORG, orderNumber: 'ORD202611-020', customerId: CUST, sourceQuotationId: QO, status: 'QUOTATION_SIGNED', createdAt: new Date(1) });
const doDoc = (id: string, name: string, over: Row = {}) => ({
  id,
  organizationId: ORG,
  type: 'DELIVERY_ORDER',
  name,
  status: 'draft',
  createdAt: new Date(2),
  config: { orderId: uid(50), date: '2026-11-18', items: [{ description: 'Degreasing', quantity: 1 }], ...over },
});

// ── pure helpers ──────────────────────────────────────────────────────────
describe('quick job quotation: helpers', () => {
  it('reads the customer, Subject and job location of a WCT quotation', () => {
    const cfg = { customerId: CUST, subject: ' Degrease ', location: '51 Circular Road', customerAddress: 'billing' };
    expect(quotationCustomerIdOf(cfg)).toBe(CUST);
    expect(quotationCustomerIdOf({ customer: { id: 'x' }, customerId: 'y' })).toBe('x');
    expect(quotationSubjectOf(cfg)).toBe('Degrease');
    expect(quotationSiteOf(cfg)).toBe('51 Circular Road');
    // No job location: null (the form falls back to the customer's address, never the billing address).
    expect(quotationSiteOf({ customerAddress: 'billing' })).toBeNull();
  });
  it('status label: the order when there is one', () => {
    expect(quotationStatusLabel('confirmed', 'ORD202611-014')).toBe('Order ORD202611-014');
    expect(quotationStatusLabel('unconfirmed', null)).toBe('Not signed');
    expect(quotationStatusLabel('draft', null)).toBe('Draft');
  });
  it('search text is escaped; limit capped', () => {
    expect(likePattern('  50%_off ')).toBe('%50\\%\\_off%');
    expect(likePattern('')).toBeNull();
    expect(searchLimit(undefined)).toBe(20);
    expect(searchLimit('500')).toBe(50);
    expect(isUuid(CUST)).toBe(true);
    expect(isUuid("1' OR 1=1")).toBe(false);
  });
  it('open DOs: not cancelled, not completed, not waiting on the sign link', () => {
    expect(isOpenDo({ status: 'draft', config: {} })).toBe(true);
    expect(isOpenDo({ status: 'delivered_installed', config: {} })).toBe(false);
    expect(isOpenDo({ status: 'draft', config: { cancelled: true } })).toBe(false);
    expect(isOpenDo({ status: 'confirmed', config: { awaitingSignature: true } })).toBe(false);
  });
  it('DO pick: the only one, the picked one among several (required), none', () => {
    expect(pickDoForJob([], undefined)).toBeNull();
    expect(pickDoForJob(['a'], undefined)).toBe('a');
    expect(() => pickDoForJob(['a', 'b'], undefined)).toThrow(BadRequestException);
    expect(() => pickDoForJob(['a', 'b'], 'c')).toThrow(BadRequestException);
    expect(pickDoForJob(['a', 'b'], 'b')).toBe('b');
  });
  it('job lines mirror the DO lines, pointing at it', () => {
    const rows = jobRowsFromDo('do1', { items: [{ description: 'Degrease', quantity: 2 }, { assetId: 'a1', description: 'Fan' }, { assetId: 'a1', description: 'Fan' }] });
    expect(rows).toEqual([
      expect.objectContaining({ assetId: null, assetClass: 'SERVICE', quantity: 2, sortOrder: 0, documentId: 'do1' }),
      expect.objectContaining({ assetId: 'a1', quantity: 1, sortOrder: 100, documentId: 'do1' }),
      expect.objectContaining({ assetId: 'a1', quantity: 1, sortOrder: 201, documentId: 'do1' }),
    ]);
  });
  it('a waiting job has no order and no lines', () => {
    expect(pendingQuotationJobsWhere(ORG, QO)).toEqual({ organizationId: ORG, sourceQuotationId: QO, orderId: null, status: { not: 'cancelled' }, items: { none: {} } });
  });
});

// ── service: each link case ───────────────────────────────────────────────
describe('quick job with a quotation: linking on save', () => {
  it('order with exactly one open DO: job on the order AND the DO (blue), no new DO, no second job', async () => {
    const db = seed({ ...GATE, enableManualOrderFlow: true }, { order: [order(uid(50))] });
    db.document.push(doDoc(uid(60), 'DO202611030'), doDoc(uid(61), 'DO202611029', { cancelled: true }), doDoc(uid(62), 'DO202611028'));
    db.document.find((d) => d.id === uid(62))!.status = 'delivered_installed';
    const s = svc(db);
    const docsBefore = db.document.length;
    const r: any = await s.createQuickJob(ORG, body({ quotationId: QO }));
    expect(r).toEqual(expect.objectContaining({ orderId: uid(50), orderNumber: 'ORD202611-020', doId: uid(60), doName: 'DO202611030' }));
    const job = db.delivery[0];
    expect(db.delivery).toHaveLength(1);
    expect(job.orderId).toBe(uid(50));
    expect(job.sourceQuotationId).toBe(QO);
    expect(db.deliveryItem.every((i) => i.deliveryId === job.id && i.documentId === uid(60))).toBe(true);
    expect(db.deliveryItem).toHaveLength(1);
    expect(db.document.length).toBe(docsBefore); // no DO made
    // The DO's date follows the job's day (it is still a draft), as when an "Add job" job is scheduled.
    expect(db.document.find((d) => d.id === uid(60))!.config.date).toBe('2026-11-20');
  });

  it('several open DOs: the DO is required, and the picked one is used', async () => {
    const db = seed({ ...GATE, enableManualOrderFlow: true }, { order: [order(uid(50))] });
    db.document.push(doDoc(uid(60), 'DO202611030'), doDoc(uid(63), 'DO202611031'));
    const s = svc(db);
    const preview: any = await s.quickJobQuotation(ORG, QO);
    expect(preview.openDos.map((d: any) => d.name)).toEqual(['DO202611030', 'DO202611031']);
    await expect(s.createQuickJob(ORG, body({ quotationId: QO }))).rejects.toThrow(/pick the DO/);
    expect(db.delivery).toHaveLength(0); // checked before anything is written
    await s.createQuickJob(ORG, body({ quotationId: QO, doId: uid(63) }));
    expect(db.deliveryItem.map((i) => i.documentId)).toEqual([uid(63)]);
  });

  it('order with no open DO: the job is on the order only', async () => {
    const db = seed({ ...GATE, enableManualOrderFlow: true }, { order: [order(uid(50))] });
    const r: any = await svc(db).createQuickJob(ORG, body({ quotationId: QO }));
    expect(r.orderId).toBe(uid(50));
    expect(r.doId).toBeNull();
    expect(db.delivery[0].orderId).toBe(uid(50));
    expect(db.deliveryItem).toHaveLength(0);
  });

  it('without the manual order flow (WCT Racking): order only, never put on another job\'s DO', async () => {
    const db = seed(GATE, { order: [order(uid(50))] });
    db.document.push(doDoc(uid(60), 'DO202611030'));
    const r: any = await svc(db).createQuickJob(ORG, body({ quotationId: QO }));
    expect(r.orderId).toBe(uid(50));
    expect(r.doId).toBeNull();
    expect(db.deliveryItem).toHaveLength(0);
  });

  it('not signed yet: the job keeps the quotation (Misc); signing moves it onto the order and its first DO', async () => {
    const db = seed({ ...GATE, enableManualOrderFlow: true, enableQuotationToDelivery: true });
    const s = svc(db);
    const r: any = await s.createQuickJob(ORG, body({ quotationId: QO }));
    expect(r.orderId).toBeNull();
    const job = db.delivery[0];
    expect(job).toEqual(expect.objectContaining({ orderId: null, sourceQuotationId: QO, isDraft: false, status: 'scheduled' }));

    // Signing: the hook makes the order (DO first) and moves the waiting job, no extra job.
    db.document[0].status = 'confirmed';
    const run = await autoDraftDeliveryFromQuotation(s['prisma'], ORG, QO);
    expect(run).toEqual(expect.objectContaining({ doFirst: true }));
    expect(db.order).toHaveLength(1);
    expect(db.delivery).toHaveLength(1);
    expect(job.orderId).toBe(db.order[0].id);

    // Then the caller issues the order's first DO (prepareManualOrderDo): the job goes on it.
    const docs: any = { createNumberedDeliveryOrder: jest.fn(async (_t: string, org: string, config: any) => {
      const d = { id: uid(70), organizationId: org, type: 'DELIVERY_ORDER', name: 'DO202611040', status: 'draft', createdAt: new Date(3), config };
      db.document.push(d);
      return d;
    }) };
    (s as any).documentsService = docs;
    (s as any).resolveDeliveryOrderTemplateId = async () => 'tpl';
    const first = await s.prepareManualOrderDo(db.order[0].id, ORG);
    expect(first?.doId).toBe(uid(70));
    expect(docs.createNumberedDeliveryOrder).toHaveBeenCalledTimes(1);
    expect(db.deliveryItem.length).toBeGreaterThan(0);
    expect(db.deliveryItem.every((i) => i.deliveryId === job.id && i.documentId === uid(70))).toBe(true);
  });

  it('not signed, non-manual flow: signing moves the job onto the order with NO automatic first job', async () => {
    const db = seed({ ...GATE, enableQuotationToDelivery: true });
    const s = svc(db);
    await s.createQuickJob(ORG, body({ quotationId: QO }));
    db.document[0].status = 'confirmed';
    const run: any = await autoDraftDeliveryFromQuotation(s['prisma'], ORG, QO);
    expect(db.delivery).toHaveLength(1);
    expect(run.id).toBe(db.delivery[0].id);
    expect(db.delivery[0].orderId).toBe(db.order[0].id);
  });

  it('a quotation signed while the form was open: the job still lands on the order', async () => {
    const db = seed({ ...GATE, enableManualOrderFlow: true });
    const s = svc(db);
    const prisma = s['prisma'] as any;
    const realCreate = prisma.delivery.create;
    prisma.delivery.create = async (args: any) => {
      db.order.push(order(uid(51))); // the signature lands between the form's check and the save
      return realCreate(args);
    };
    const r: any = await s.createQuickJob(ORG, body({ quotationId: QO }));
    expect(r.orderId).toBe(uid(51));
    expect(db.delivery[0].orderId).toBe(uid(51));
  });

  it('a cancelled quotation or cancelled order is refused', async () => {
    const db = seed(GATE, { order: [{ ...order(uid(50)), status: 'CANCELLED' }] });
    await expect(svc(db).createQuickJob(ORG, body({ quotationId: QO }))).rejects.toThrow(/cancelled/);
    const db2 = seed(GATE);
    db2.document[0].config.cancelled = true;
    await expect(svc(db2).createQuickJob(ORG, body({ quotationId: QO }))).rejects.toThrow(/cancelled/);
    await expect(svc(seed(GATE)).createQuickJob(ORG, body({ quotationId: 'not-a-uuid' }))).rejects.toThrow(/not found/);
  });

  it('autofill data: customer, job location (else the customer address), Subject', async () => {
    const db = seed(GATE);
    const q: any = await svc(db).quickJobQuotation(ORG, QO);
    expect(q).toEqual(expect.objectContaining({ name: 'QO202611-0040', customerId: CUST, subject: 'Chemical degreasing', siteOrAddress: '51 Circular Road', statusLabel: 'Not signed', openDos: [] }));
    expect(q.customer).toEqual(expect.objectContaining({ id: CUST, name: 'TEST Client' }));
    delete db.document[0].config.location;
    expect(((await svc(db).quickJobQuotation(ORG, QO)) as any).siteOrAddress).toBe('1 Raffles Place, Singapore 048616');
  });

  // 2026-11-23: the search matches in the company's index (quotation-search-index.ts), then reads only the rows shown.
  const indexRow = (id: string, name: string, subject: string, extra: Record<string, unknown> = {}) => ({
    id, name, listSearch: 'test client', listCustomerId: CUST, subject, dsubject: null, cancelled: null, voided: null,
    createdAt: new Date('2026-11-20T00:00:00Z'), updatedAt: new Date('2026-11-20T00:00:00Z'), ...extra,
  });
  const listRow = (id: string, name: string, subject: string, orderStatus: string | null = null) => ({
    id, name, status: 'unconfirmed', config: { subject, customerId: CUST }, customerName: 'TEST Client', orderId: orderStatus ? uid(90) : null, orderNumber: orderStatus ? 'ORDW202611-001' : null, orderStatus,
  });

  it('search: matches number / customer / Subject in the index, cancelled ones never, reads only what is shown', async () => {
    quotationIndex.invalidate();
    const s = svc(seed(GATE));
    const prisma = s['prisma'] as any;
    const OTHER = uid(70);
    const GONE = uid(71);
    prisma.$queryRawUnsafe = jest.fn(async () => [
      indexRow(QO, 'QO202611-0040', 'Degrease'),
      indexRow(OTHER, 'QO202611-0041', 'Paint'),
      indexRow(GONE, 'QO202611-0042', 'Degrease again', { cancelled: 'true' }),
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([listRow(QO, 'QO202611-0040', 'Degrease')]);
    const rows = await s.searchQuickJobQuotations(ORG, { q: 'DEGR', customerId: CUST });
    expect(rows).toEqual([expect.objectContaining({ id: QO, name: 'QO202611-0040', customerName: 'TEST Client', subject: 'Degrease', statusLabel: 'Not signed' })]);
    expect(prisma.$queryRawUnsafe.mock.calls[0][1]).toBe(ORG);
    const [customerSql, ...customerVals] = prisma.$queryRaw.mock.calls[0];
    expect(customerSql.join('?')).toMatch(/FROM "Customer" WHERE "organizationId" = \?/);
    expect(customerVals).toEqual(expect.arrayContaining([ORG, '%degr%']));
    const [listSql, ...listVals] = prisma.$queryRaw.mock.calls[1];
    expect(listSql.join('?')).toMatch(/d."organizationId" = \?/);
    const shown = JSON.stringify(listVals);
    expect(shown).toContain(QO);
    expect(shown).not.toContain(OTHER);
    expect(shown).not.toContain(GONE);
    // Every search keeps the index: no second full read within seconds.
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await s.searchQuickJobQuotations(ORG, { q: 'paint' });
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('before typing: the newest OPEN quotations (an order paid / closed / complete / cancelled leaves it out), max 20', async () => {
    quotationIndex.invalidate();
    const s = svc(seed(GATE));
    const prisma = s['prisma'] as any;
    const ids = Array.from({ length: 30 }, (_, i) => uid(100 + i));
    prisma.$queryRawUnsafe = jest.fn(async () => ids.map((id, i) => indexRow(id, `QO-${i}`, 'Job', { createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)) })));
    const statuses = ['PAID', 'CLOSED', 'COMPLETED', 'CANCELLED', 'OPEN', null];
    prisma.$queryRaw.mockImplementation(async (_s: any, ...vals: any[]) => {
      const asked = ids.filter((id) => JSON.stringify(vals).includes(id));
      return asked.map((id) => listRow(id, `QO-${ids.indexOf(id)}`, 'Job', statuses[ids.indexOf(id) % statuses.length]));
    });
    const rows = await s.searchQuickJobQuotations(ORG, {});
    expect(rows.length).toBeLessThanOrEqual(20);
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((r: any) => !r.orderNumber || r.statusLabel)).toBe(true);
    const names = rows.map((r: any) => Number(String(r.name).slice(3)));
    expect(names).toEqual([...names].sort((a, b) => b - a)); // newest first
    for (const n of names) expect(['OPEN', null]).toContain(statuses[n % statuses.length]);
    prisma.$queryRaw.mockReset();
  });
});

// ── other orgs unchanged ──────────────────────────────────────────────────
describe('gate off: old behaviour exactly', () => {
  it('quotation search, preview and save need the calendar-add gate', async () => {
    for (const f of [{}, { enableJobsCalendar: true }, { enableWctOrders: true }]) {
      const s = svc(seed(f));
      await expect(s.searchQuickJobQuotations(ORG, {})).rejects.toThrow(/not enabled/);
      await expect(s.quickJobQuotation(ORG, QO)).rejects.toThrow(/not enabled/);
      await expect(s.createQuickJob(ORG, body({ quotationId: QO }))).rejects.toThrow(/not enabled/);
    }
  });
  it('a quick job without a quotation saves exactly as before (no order, no quotation, no lines)', async () => {
    const db = seed(GATE);
    const r: any = await svc(db).createQuickJob(ORG, body());
    expect(Object.keys(r).sort()).toEqual(['deliveryNumber', 'id']);
    expect(db.delivery[0].orderId).toBeNull();
    expect(db.delivery[0].sourceQuotationId).toBeNull();
    expect(db.deliveryItem).toHaveLength(0);
  });
  it('quotation acceptance in an org without WCT orders: the existing-run guard is unchanged', async () => {
    const db = seed({ enableQuotationToDelivery: true });
    db.document[0].status = 'confirmed';
    // A run already made from the quotation (with no lines) still blocks a second one there.
    db.delivery.push({ id: uid(80), organizationId: ORG, deliveryNumber: 1, status: 'scheduled', isDraft: true, orderId: null, sourceQuotationId: QO });
    const prisma = makePrisma(db);
    expect(await autoDraftDeliveryFromQuotation(prisma, ORG, QO)).toBeNull();
    expect(db.delivery).toHaveLength(1);
    expect(db.order).toHaveLength(0);
  });
  it('WCT orders: a run auto-made from the quotation (it has lines) still blocks; the order flow is unchanged otherwise', async () => {
    const db = seed({ enableWctOrders: true, enableQuotationToDelivery: true });
    db.document[0].status = 'confirmed';
    db.delivery.push({ id: uid(81), organizationId: ORG, deliveryNumber: 1, status: 'scheduled', isDraft: true, orderId: null, sourceQuotationId: QO });
    db.deliveryItem.push({ id: uid(82), deliveryId: uid(81), description: 'Degreasing', documentId: null });
    expect(await autoDraftDeliveryFromQuotation(makePrisma(db), ORG, QO)).toBeNull();
    // Without any waiting job, acceptance makes the order WITH its automatic first job, as before.
    const db2 = seed({ enableWctOrders: true, enableQuotationToDelivery: true });
    db2.document[0].status = 'confirmed';
    const run: any = await autoDraftDeliveryFromQuotation(makePrisma(db2), ORG, QO);
    expect(db2.order).toHaveLength(1);
    expect(db2.delivery).toHaveLength(1);
    expect(db2.delivery[0]).toEqual(expect.objectContaining({ isDraft: true, orderId: db2.order[0].id, sourceQuotationId: QO }));
    expect(run.id).toBe(db2.delivery[0].id);
  });
});

// ── Job category (WCT group, deliveries/job-category.ts) ──────────────────
describe('quick job: job category', () => {
  const CAT = uid(90);
  const catField = { id: CAT, organizationId: ORG, entityType: 'Delivery', fieldName: 'job_category', isActive: true, options: [{ value: 'Service order', label: 'Service order' }, { value: 'Delivery', label: 'Delivery' }, { value: 'Site visit', label: 'Site visit' }, { value: 'Others', label: 'Others' }], defaultValue: 'Service order' };
  const withCat = (features: Record<string, boolean>) => seed(features, { customField: [catField], customFieldValue: [] } as any);

  it('stores the picked category; blank stores the default; off the list is refused', async () => {
    const db = withCat({ ...GATE, enableJobFields: true });
    const s = svc(db);
    const a: any = await s.createQuickJob(ORG, body({ category: 'Site visit' }));
    expect(db.customFieldValue).toEqual([expect.objectContaining({ customFieldId: CAT, entityId: a.id, value: 'Site visit' })]);
    const b: any = await s.createQuickJob(ORG, body());
    expect(db.customFieldValue.find((v: any) => v.entityId === b.id)?.value).toBe('Service order');
    await expect(s.createQuickJob(ORG, body({ category: 'Painting' }))).rejects.toThrow(/Job category must be one of/);
  });
  it('edit + the job page: change it; a job with nothing stored reads as the default', async () => {
    const db = withCat({ ...GATE, enableJobFields: true });
    const s = svc(db);
    const a: any = await s.createQuickJob(ORG, body({ category: 'Delivery' }));
    await s.updateQuickJob(a.id, ORG, body({ category: 'Others' }));
    expect(db.customFieldValue.find((v: any) => v.entityId === a.id)?.value).toBe('Others');
    // 2026-11-25: the form has no Category field; an edit that sends none keeps the job's own.
    await s.updateQuickJob(a.id, ORG, body());
    expect(db.customFieldValue.find((v: any) => v.entityId === a.id)?.value).toBe('Others');
    db.delivery.push({ id: uid(91), organizationId: ORG, deliveryNumber: 99, status: 'scheduled', isDraft: false, orderId: uid(50) });
    expect(await s.jobCategoryOfRun(uid(91), ORG)).toEqual({ value: 'Service order', options: ['Service order', 'Delivery', 'Site visit', 'Others'], defaultValue: 'Service order' });
    await s.saveJobCategory(uid(91), ORG, 'delivery');
    expect((await s.jobCategoryOfRun(uid(91), ORG))?.value).toBe('Delivery');
  });
  it('orgs without the field or without enableJobFields: nothing asked, stored or returned (as before)', async () => {
    for (const db of [seed({ ...GATE, enableJobFields: true }, { customField: [], customFieldValue: [] } as any), withCat(GATE)]) {
      const s = svc(db);
      const r: any = await s.createQuickJob(ORG, body({ category: 'Painting' }));
      expect(Object.keys(r).sort()).toEqual(['deliveryNumber', 'id']);
      expect(db.customFieldValue).toHaveLength(0);
      expect(await s.jobCategoryOf(ORG)).toBeNull();
      expect(await s.jobCategoryOfRun(r.id, ORG)).toBeNull();
      await expect(s.saveJobCategory(r.id, ORG, 'Delivery')).rejects.toThrow(/not set up/);
    }
  });
});
