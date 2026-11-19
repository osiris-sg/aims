jest.mock('../delivery-group-posts/enqueue', () => ({ enqueueDeliveryGroupPost: jest.fn(async () => null) }));
jest.mock('../maintenance-reports/wct-brand', () => ({ wctBrandStamp: jest.fn(async () => ({})) }));

import { DeliveriesService } from '../deliveries/deliveries.service';
import { isOpenDo } from '../deliveries/quick-job-quotation';
import { autoDraftDeliveryFromQuotation } from '../deliveries/quotation-to-delivery';
import { DocumentsService } from '../documents/documents.service';
import { OrdersService } from './orders.service';
import { IMPORTED_ORDER_SOURCE, assertImportedOrderOpen, assertNotImportedOrder, hasAimsLinks, importedOrderLinkingQuotation, planImportedOrders } from './imported-orders';
import { holderRefusal, orderHoldsDoc, withLinkedDocument, withoutLinkedDocument } from './imported-order-links';
import { importedInvoicePrefill } from './imported-remaining';

/**
 * Imported orders fully open for backfilling (WCT group, round 19, 2026-11-19). Over a small in-memory Prisma:
 * Add DO / Add job / Create invoice / Link on a Paid and a Part billed imported order, the status recompute
 * (extra quotation, AIMS invoice, DOs), one order per document, Unlink, imported documents never written, and
 * native orders / other orgs unchanged.
 */

const ORG = '5c700000-0000-4000-8000-5c7000000001';
const OTHER = '0a000000-0000-4000-8000-000000000099';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CUST = uid(1);
const CUST2 = uid(2);
const ON = { enableWctOrders: true, enableManualOrderFlow: true, enableWctOrderInvoice: true, enableImportedOrders: true, enableJobsCalendar: true };
const MA = 'Maintenance agreement of 2 times per year package';
const zero = (d: string) => ({ description: d, quantity: 1, unitPrice: 0, amount: 0 });
const ERP = { source: 'wct-erp' };

type Row = Record<string, any>;
type Db = Record<string, Row[]>;

// ── tiny in-memory Prisma (JSON path / array_contains like Postgres jsonb @>) ──
const JSON_FIELDS = new Set(['config', 'linkedDocuments', 'attachments', 'serviceData']);
const getPath = (o: any, path: string[]) => path.reduce((x, p) => (x == null ? x : x[p]), o);
const contains = (hay: any, needle: any): boolean => {
  if (Array.isArray(needle)) return Array.isArray(hay) && needle.every((n) => hay.some((h) => contains(h, n)));
  if (needle && typeof needle === 'object') return !!hay && typeof hay === 'object' && Object.entries(needle).every(([k, v]) => contains(hay[k], v));
  return hay === needle;
};

function makePrisma(db: Db) {
  let seq = 5000;
  const writes: Array<[string, string, any]> = [];
  const relOf = (table: string, row: Row, key: string): { rows: Row[] | Row | null; table: string } | undefined => {
    if (table === 'delivery' && key === 'items') return { rows: db.deliveryItem.filter((i) => i.deliveryId === row.id), table: 'deliveryItem' };
    if ((table === 'deliveryItem' || table === 'maintenanceServiceReport') && key === 'delivery') return { rows: db.delivery.find((d) => d.id === row.deliveryId) ?? null, table: 'delivery' };
    return undefined;
  };
  const cond = (v: any, c: any): boolean => {
    if (c === null) return v == null;
    if (c && typeof c === 'object' && !Array.isArray(c) && !(c instanceof Date)) {
      if ('in' in c) return c.in.includes(v);
      if ('not' in c) return c.not === null ? v != null : typeof c.not === 'object' && c.not ? !cond(v, c.not) : v !== c.not;
      if ('equals' in c) return typeof c.equals === 'string' && c.mode === 'insensitive' ? String(v ?? '').toLowerCase() === c.equals.toLowerCase() : v === c.equals;
      if ('startsWith' in c) return String(v ?? '').startsWith(c.startsWith);
      if ('contains' in c) return String(v ?? '').toLowerCase().includes(String(c.contains).toLowerCase());
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
      if (JSON_FIELDS.has(k) && c && typeof c === 'object' && ('path' in c || 'array_contains' in c || 'equals' in c)) {
        const v = c.path ? getPath(row[k], c.path) : row[k];
        if ('array_contains' in c) return contains(v, c.array_contains);
        return v === c.equals;
      }
      const rel = relOf(table, row, k);
      if (rel) {
        if (Array.isArray(rel.rows)) {
          if (c.some) return rel.rows.some((x) => match(rel.table, x, c.some));
          if (c.none) return !rel.rows.some((x) => match(rel.table, x, c.none));
          return true;
        }
        return rel.rows ? match(rel.table, rel.rows, c) : false;
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
  const withRel = (table: string, r: Row) => {
    if (table === 'order') {
      return {
        ...r,
        customer: db.customer.find((c) => c.id === r.customerId) ?? null,
        sourceQuotation: db.document.find((d) => d.id === r.sourceQuotationId) ?? null,
        deliveries: db.delivery.filter((d) => d.orderId === r.id).map((d) => ({ ...d, items: db.deliveryItem.filter((i) => i.deliveryId === d.id) })),
      };
    }
    if (table === 'delivery') {
      const items = db.deliveryItem.filter((i) => i.deliveryId === r.id);
      return { ...r, items, _count: { items: items.length } };
    }
    if (table === 'deliveryItem' || table === 'maintenanceServiceReport') return { ...r, delivery: db.delivery.find((d) => d.id === r.deliveryId) ?? null };
    return r;
  };
  const model = (table: string) => ({
    findFirst: async ({ where, orderBy }: any = {}) => {
      const r = sortBy(db[table].filter((x) => match(table, x, where)), orderBy)[0];
      return r ? withRel(table, r) : null;
    },
    findUnique: async ({ where }: any) => db[table].find((x) => match(table, x, where)) ?? null,
    findMany: async ({ where, orderBy, take }: any = {}) => sortBy(db[table].filter((x) => match(table, x, where)), orderBy).slice(0, take ?? undefined).map((r) => withRel(table, r)),
    count: async ({ where }: any = {}) => db[table].filter((x) => match(table, x, where)).length,
    create: async ({ data }: any) => {
      const { items, ...rest } = data;
      const row: Row = { id: rest.id ?? uid(++seq), createdAt: new Date(Date.now() + seq), ...rest };
      if (table === 'delivery') {
        row.orderId = row.orderId ?? null;
        for (const it of items?.create ?? []) db.deliveryItem.push({ id: uid(++seq), deliveryId: row.id, documentId: null, ...it });
      }
      db[table].push(row);
      writes.push([table, 'create', row]);
      return row;
    },
    update: async ({ where, data }: any) => {
      const r = db[table].find((x) => match(table, x, where));
      writes.push([table, 'update', { where, data }]);
      Object.assign(r!, data);
      return r;
    },
    updateMany: async ({ where, data }: any) => {
      const hit = db[table].filter((x) => match(table, x, where));
      hit.forEach((x) => Object.assign(x, data));
      writes.push([table, 'updateMany', { where, data }]);
      return { count: hit.length };
    },
  });
  const prisma: any = { $queryRaw: jest.fn(async () => []), $executeRawUnsafe: jest.fn(async () => 0), writes };
  for (const t of Object.keys(db)) prisma[t] = model(t);
  prisma.$transaction = async (fn: any) => fn(prisma);
  return prisma;
}

// ── fixtures ──────────────────────────────────────────────────────────────
const Q1 = uid(10); // imported quotation of the Paid order (2 x MA 1,200 + GST = 2,616)
const Q2 = uid(11); // imported quotation of the Part billed order
const QX = uid(12); // an extra AIMS quotation of the same customer (1,090)
const QO = uid(13); // a quotation of another customer
const QN = uid(14); // the native order's quotation
const I1 = uid(20);
const I2 = uid(21);
const I3 = uid(22);
const IX = uid(23); // an AIMS invoice of the same customer, made elsewhere, no order
const IN = uid(24); // the native order's invoice
const DX = uid(30); // an AIMS DO of the same customer, no order
const DE = uid(31); // an imported ERP DO of the same customer, on no order
const PAID = uid(40);
const PART = uid(41);
const NATIVE = uid(42);
const SR = uid(60);

const quote = (id: string, name: string, total: number, over: Row = {}) => ({
  id,
  organizationId: ORG,
  type: 'QUOTATION',
  name,
  status: 'confirmed',
  documentTemplateId: 'tpl-q',
  createdAt: new Date(1),
  config: { customerId: CUST, customerName: 'Bar Roque Grill', subject: 'Degreasing', gstPercent: 9, totalWithTax: total, nettTotal: total, items: [zero('G- Provide tools'), { description: MA, quantity: 2, unitPrice: 1200, amount: 2400 }], ...over },
});
const inv = (id: string, name: string, over: Row = {}, cfg: Row = {}) => ({
  id,
  organizationId: ORG,
  type: 'INVOICE',
  name,
  status: 'paid',
  documentTemplateId: 'tpl-i',
  createdAt: new Date(2),
  config: { erpImport: ERP, customerId: CUST, date: '2025-01-10', totalWithTax: 1308, outstandingBalance: 0, paidToDate: 1308, items: [{ description: MA, quantity: 1, unitPrice: 1200, amount: 1200 }], ...cfg },
  ...over,
});
const marker = (over: Row = {}) => ({ source: IMPORTED_ORDER_SOURCE, batch: 'b', quotationNo: 'Q-014154', linkSources: {}, erpDoNumbers: [], at: 'x', quoteTotal: 2616, credits: {}, partBilledRule: true, ...over });

function seed(features: Record<string, boolean> = ON): Db {
  return {
    organizationUIConfig: [{ organizationId: ORG, features }],
    organization: [{ id: ORG, taxRate: 9 }],
    accountingSetting: [],
    customer: [
      { id: CUST, organizationId: ORG, name: 'Bar Roque Grill', address: '165 Tanjong Pagar Road', email: null, customerCode: 'B1' },
      { id: CUST2, organizationId: ORG, name: 'Other Cafe', address: 'x', email: null, customerCode: 'O1' },
    ],
    document: [
      quote(Q1, 'Q-014154', 2616, { erpImport: ERP }),
      quote(Q2, 'Q-014155', 2616, { erpImport: ERP }),
      quote(QX, 'QO202611-0050', 1090, { items: [{ description: 'Extra degreasing', quantity: 1, unitPrice: 1000, amount: 1000 }] }),
      quote(QO, 'QO202611-0051', 500, { customerId: CUST2 }),
      quote(QN, 'QO202611-0049', 1090),
      inv(I1, 'I-014521'),
      inv(I2, 'I-014600', {}, { date: '2025-06-10' }),
      inv(I3, 'I-014700'),
      inv(IX, 'INV202611-0090', { status: 'pending_payment' }, { erpImport: undefined, outstandingBalance: 1090, paidToDate: 0, totalWithTax: 1090 }),
      inv(IN, 'INV202611-0080', { status: 'pending_payment' }, { erpImport: undefined, orderId: NATIVE, outstandingBalance: 1090, paidToDate: 0, totalWithTax: 1090 }),
      { id: DX, organizationId: ORG, type: 'DELIVERY_ORDER', name: 'DO202611050', status: 'draft', documentTemplateId: 'tpl-d', createdAt: new Date(3), config: { customerId: CUST, items: [{ description: 'Degreasing', quantity: 1 }] } },
      { id: DE, organizationId: ORG, type: 'DELIVERY_ORDER', name: 'DO012600', status: 'delivered_installed', documentTemplateId: 'tpl-d', createdAt: new Date(3), config: { customerId: CUST, date: '2025-02-01', erpImport: { source: 'wct-erp', kind: 'DELIVERY_ORDER', status: 'Issued', done: true }, items: [] } },
    ],
    order: [
      // Paid in full (2 x 1,308 of 2,616, both paid), the 19 Nov rule.
      { id: PAID, organizationId: ORG, orderNumber: 'ORD-Q-014154', customerId: CUST, sourceQuotationId: Q1, status: 'PAID', createdAt: new Date(5), attachments: null, statusDates: null, linkedDocuments: { invoice: [{ id: I1, name: 'I-014521', total: 1308 }, { id: I2, name: 'I-014600', total: 1308 }], creditNote: [], do: [], imported: marker() } },
      // Part billed (1,308 of 2,616).
      { id: PART, organizationId: ORG, orderNumber: 'ORD-Q-014155', customerId: CUST, sourceQuotationId: Q2, status: 'PART_BILLED', createdAt: new Date(6), attachments: null, statusDates: null, linkedDocuments: { invoice: [{ id: I3, name: 'I-014700', total: 1308 }], creditNote: [], do: [], imported: marker({ quotationNo: 'Q-014155' }) } },
      // A native order of the same customer.
      { id: NATIVE, organizationId: ORG, orderNumber: 'ORD202611-020', customerId: CUST, sourceQuotationId: QN, status: 'INVOICED', createdAt: new Date(7), attachments: null, statusDates: null, linkedDocuments: { po: [], do: [], invoice: [{ id: IN, name: 'INV202611-0080' }], salesOrder: [] } },
    ],
    delivery: [],
    deliveryItem: [],
    deliverySiteClockJob: [],
    maintenanceServiceReport: [{ id: SR, organizationId: ORG, kind: 'SERVICE', reportNumber: 12, status: 'completed', deliveryId: null, createdAt: new Date(8), serviceData: { customerId: CUST, uploaded: true } }],
    asset: [],
    auditLog: [],
    supplier: [],
    payment: [],
    journalEntry: [],
  };
}

function world(features: Record<string, boolean> = ON) {
  const db = seed(features);
  const prisma = makePrisma(db);
  const orders = new OrdersService(prisma, {} as any, {} as any);
  const deliveries = new DeliveriesService(prisma, {} as any, {} as any, {} as any, {} as any);
  const created: any[] = [];
  (deliveries as any).documentsService = {
    createNumberedDeliveryOrder: jest.fn(async (_t: string, org: string, config: any) => {
      const d = { id: uid(70 + created.length), organizationId: org, type: 'DELIVERY_ORDER', name: `DO2026110${70 + created.length}`, status: 'draft', documentTemplateId: 'tpl-d', createdAt: new Date(9), config };
      created.push(d);
      db.document.push(d);
      return d;
    }),
  };
  (deliveries as any).resolveDeliveryOrderTemplateId = async () => 'tpl-d';
  const documents: any = Object.create(DocumentsService.prototype);
  documents.prisma = prisma;
  documents.resolveTemplateIdForType = jest.fn(async () => 'tpl-i');
  documents.repostGlForDocument = jest.fn(async () => undefined);
  documents.createBasicDocument = jest.fn(async (_t: string, type: string, org: string, config: any, _p?: any, _x?: any, name?: string) => {
    const d = { id: uid(80 + db.document.length), organizationId: org, type, name: name ?? 'INV202611-0100', status: 'draft', documentTemplateId: 'tpl-i', createdAt: new Date(10), config };
    db.document.push(d);
    return d;
  });
  const order = (id: string) => db.order.find((o) => o.id === id)!;
  const doc = (id: string) => db.document.find((d) => d.id === id)!;
  const actor = { id: 'user_1', name: 'Finance' };
  return { db, prisma, orders, deliveries, documents, order, doc, actor };
}

/** Writes to documents that were imported (or existed before the test): there must be none. */
const docWrites = (w: ReturnType<typeof world>, ids: string[]) => w.prisma.writes.filter(([t, op, a]: any) => t === 'document' && op !== 'create' && ids.some((id) => JSON.stringify(a.where).includes(id)));
const EXISTING_DOCS = [Q1, Q2, QX, QO, QN, I1, I2, I3, IX, IN, DX, DE];

describe('imported orders open (round 19): the work entry points', () => {
  it('assertImportedOrderOpen: native orders pass; imported orders pass with the setting on and are refused with it off', async () => {
    const on = world();
    await expect(assertImportedOrderOpen(on.prisma, ORG, NATIVE)).resolves.toBeUndefined();
    await expect(assertImportedOrderOpen(on.prisma, ORG, PAID)).resolves.toBeUndefined();
    const off = world({ ...ON, enableImportedOrders: false });
    await expect(assertImportedOrderOpen(off.prisma, ORG, PAID)).rejects.toThrow(/switched off/);
    await expect(assertImportedOrderOpen(off.prisma, ORG, NATIVE)).resolves.toBeUndefined();
    // Cancel / delete / edit stay refused on an imported order, setting on or off.
    await expect(assertNotImportedOrder(on.prisma, ORG, PAID)).rejects.toThrow(/cannot be cancelled, deleted or edited/);
    await expect(on.orders.cancelWctOrder(PAID, ORG)).rejects.toThrow(/cannot be cancelled/);
    await expect(on.orders.updateStatus(PAID, ORG, 'OPEN')).rejects.toThrow(/cannot be cancelled/);
    await expect(on.orders.delete(PAID, ORG)).rejects.toThrow(/cannot be cancelled/);
  });

  it.each([
    ['Paid', PAID],
    ['Part billed', PART],
  ])('Add DO on a %s imported order: a native draft DO with normal numbering, on the order', async (_l, id) => {
    const w = world();
    const r = await w.deliveries.prepareManualOrderDo(id, ORG, { force: true, throwOnError: true });
    expect(r?.doName).toMatch(/^DO2026110/);
    const d = w.doc(r!.doId);
    expect(d.config).toMatchObject({ orderId: id, orderNo: w.order(id).orderNumber, sourceDocumentId: w.order(id).sourceQuotationId });
    expect((w.deliveries as any).documentsService.createNumberedDeliveryOrder).toHaveBeenCalledTimes(1);
    // The order page's DO step shows it (a draft); money decides the status while something is billed.
    const page: any = await w.orders.getById(id, ORG);
    expect(page.deliveryOrders.map((x: any) => x.name)).toEqual([d.name]);
    expect(page.tracker.find((s: any) => s.key === 'do')).toMatchObject({ state: 'todo', note: `${d.name} (Draft)` });
    expect(page.status).toBe(id === PAID ? 'PAID' : 'PART_BILLED');
    expect(docWrites(w, EXISTING_DOCS)).toEqual([]);
  });

  it('Add DO is refused on an imported order while the setting is off', async () => {
    const w = world({ ...ON, enableImportedOrders: false });
    await expect(w.deliveries.prepareManualOrderDo(PAID, ORG, { force: true, throwOnError: true })).rejects.toThrow(/switched off/);
  });

  it.each([
    ['Paid', PAID],
    ['Part billed', PART],
  ])('Add job on a %s imported order: a draft job on its DO (and the schedule entry point takes the order)', async (_l, id) => {
    const w = world();
    const r = await w.deliveries.prepareManualOrderDo(id, ORG, { force: true, throwOnError: true });
    const job: any = await w.deliveries.createJobForDo(ORG, r!.doId);
    expect(w.db.delivery.find((j) => j.id === job.id)).toMatchObject({ orderId: id, isDraft: true, customerId: CUST });
    expect(w.db.deliveryItem.every((i) => i.documentId === r!.doId)).toBe(true);
    await expect((w.deliveries as any).orderForNewJob(id, ORG)).resolves.toMatchObject({ id });
    const page: any = await w.orders.getById(id, ORG);
    expect(page.jobs.map((j: any) => j.id)).toEqual([job.id]);
  });

  it('an imported ERP DO is never open for a job; a native DO is as before', () => {
    expect(isOpenDo({ status: 'confirmed', config: { erpImport: { source: 'wct-erp' } } })).toBe(false);
    expect(isOpenDo({ status: 'draft', config: { orderId: 'o' } })).toBe(true);
    expect(isOpenDo({ status: 'delivered_installed', config: {} })).toBe(false);
  });

  it('a service report file / link goes on the imported order (attachments), refused with the setting off', async () => {
    const w = world();
    await w.orders.addOrderAttachment(PART, ORG, { kind: 'report', reportId: SR }, { id: 'user_1' });
    expect(w.order(PART).attachments).toEqual([expect.objectContaining({ kind: 'report', reportId: SR })]);
    const off = world({ ...ON, enableImportedOrders: false });
    await expect(off.orders.addOrderAttachment(PART, ORG, { kind: 'report', reportId: SR }, {})).rejects.toThrow(/switched off/);
  });
});

describe('imported orders open (round 19): Create invoice on any status', () => {
  const lines = [{ description: 'Maintenance agreement, extra service', quantity: 1, unitPrice: 1200 }];

  it.each([
    ['Paid', PAID, 'PAID', 'INVOICED'],
    ['Part billed', PART, 'PART_BILLED', 'PAID'],
  ])('%s: a native draft (typed lines), status unchanged while a draft; once confirmed it counts', async (_l, id, draftStatus, confirmed) => {
    const w = world();
    const out = await w.documents.invoiceImportedOrderRemainder(id, ORG, { number: null, lines });
    expect(w.documents.createBasicDocument).toHaveBeenCalledTimes(1);
    const created = w.doc(out.id);
    expect(created.config).toMatchObject({ orderId: id, sourceDocumentId: w.order(id).sourceQuotationId, nettTotal: 1308 });
    expect(created.config.erpImport).toBeUndefined();
    expect(w.order(id).linkedDocuments.invoice.at(-1)).toMatchObject({ id: out.id, native: true });
    expect(w.order(id).status).toBe(draftStatus);
    // A second one while the draft is open: refused (open the draft).
    await expect(w.documents.invoiceImportedOrderRemainder(id, ORG, { lines })).rejects.toThrow(/already has a draft invoice/);
    // Confirmed: on the Paid order it is billed and owed (Invoiced); on the Part billed one it completes the billing (paid here).
    created.status = confirmed === 'PAID' ? 'paid' : 'pending_payment';
    if (confirmed === 'PAID') Object.assign(created.config, { outstandingBalance: 0, paidToDate: 1308 });
    const page: any = await w.orders.getById(id, ORG);
    expect(page.status).toBe(confirmed);
    expect(docWrites(w, EXISTING_DOCS)).toEqual([]);
  });

  it('a Complete order takes an invoice too (the mark keeps the status Complete); the page prefills the quotation lines when billed in full', async () => {
    const w = world();
    w.order(PAID).linkedDocuments.imported.completed = { at: 'x', by: null, byName: null, reason: 'done', auto: true };
    const page: any = await w.orders.getById(PAID, ORG);
    expect(page).toMatchObject({ status: 'COMPLETED', canInvoice: true });
    // Billed in full: the quotation's own lines, as quoted.
    expect(page.invoiceLines.map((l: any) => [l.description, l.quantity, l.unitPrice])).toEqual([['G- Provide tools', 1, 0], [MA, 2, 1200]]);
    await w.documents.invoiceImportedOrderRemainder(PAID, ORG, { lines });
    expect((await w.orders.getById(PAID, ORG)).status).toBe('COMPLETED');
  });

  it('prefill: what is left, else the quotation lines, else one empty line', () => {
    const left = { lines: [{ description: MA, quantity: 1, unitPrice: 1200, amount: 1200, quotedQty: 2, billedQty: 1, priced: true }] };
    expect(importedInvoicePrefill(left, [])).toBe(left.lines);
    expect(importedInvoicePrefill({ lines: [] }, [{ description: 'X', quantity: 2, unitPrice: 5, amount: 10 }])).toEqual([{ description: 'X', quantity: 2, unitPrice: 5, amount: 10, quotedQty: 2, billedQty: null, priced: true }]);
    expect(importedInvoicePrefill({ lines: [] }, [])).toEqual([{ description: '', quantity: 1, unitPrice: 0, amount: 0, quotedQty: null, billedQty: null, priced: true }]);
  });
});

describe('imported orders open (round 19): Link existing document and the status', () => {
  it('link an extra quotation on a Paid order: the quotation total grows, Part billed (19 Nov rule), Billed % recomputed', async () => {
    const w = world();
    const out = await w.orders.linkImportedDocument(PAID, ORG, { type: 'QUOTATION', id: QX }, w.actor);
    expect(out).toMatchObject({ type: 'QUOTATION', name: 'QO202611-0050', orderNumber: 'ORD-Q-014154' });
    expect(w.order(PAID).linkedDocuments.quotation).toEqual([expect.objectContaining({ id: QX, total: 1090, linked: expect.objectContaining({ by: 'user_1', byName: 'Finance' }) })]);
    expect(w.order(PAID).status).toBe('PART_BILLED');
    const page: any = await w.orders.getById(PAID, ORG);
    expect(page).toMatchObject({ status: 'PART_BILLED', quoteTotal: 3706, billed: 2616, billedPct: 70.6 });
    expect(page.quotations).toEqual([expect.objectContaining({ id: QX, unlinkable: true })]);
    // Left to bill: the extra quotation's line.
    expect(page.invoiceLines.filter((l: any) => l.priced).map((l: any) => [l.description, l.quantity])).toEqual([['Extra degreasing', 1]]);
    // Nothing written on the quotation (or any existing document).
    expect(docWrites(w, EXISTING_DOCS)).toEqual([]);
  });

  it('link an AIMS invoice on a Part billed order: billed in full and owed = Invoiced, Paid when paid; unlink puts it back', async () => {
    const w = world();
    // 1,090 of the 1,308 left: still part billed.
    await w.orders.linkImportedDocument(PART, ORG, { type: 'INVOICE', id: IX }, w.actor);
    expect(w.order(PART).status).toBe('PART_BILLED');
    // The rest billed (1,308 in all), not paid yet: Invoiced; paid: Paid.
    Object.assign(w.doc(IX).config, { totalWithTax: 1308, outstandingBalance: 1308 });
    expect((await w.orders.getById(PART, ORG)).status).toBe('INVOICED');
    Object.assign(w.doc(IX), { status: 'paid' });
    Object.assign(w.doc(IX).config, { outstandingBalance: 0, paidToDate: 1308 });
    const page: any = await w.orders.getById(PART, ORG);
    expect(page).toMatchObject({ status: 'PAID', billed: 2616, billedPct: 100 });
    expect(page.invoices.find((i: any) => i.id === IX)).toMatchObject({ unlinkable: true, native: true, linked: { byName: 'Finance' } });
    await w.orders.unlinkImportedDocument(PART, ORG, { type: 'INVOICE', id: IX }, w.actor);
    expect(w.order(PART).linkedDocuments.invoice.map((x: any) => x.id)).toEqual([I3]);
    expect(w.order(PART).status).toBe('PART_BILLED');
    // An AIMS invoice unlinked is not remembered as an import exclusion (only imported ones are).
    expect(w.order(PART).linkedDocuments.imported.unlinked).toBeUndefined();
  });

  it('a draft AIMS invoice does not count; a draft linked from elsewhere never blocks Create invoice', async () => {
    const w = world();
    Object.assign(w.doc(IX), { status: 'draft' });
    await w.orders.linkImportedDocument(PART, ORG, { type: 'INVOICE', id: IX }, w.actor);
    expect(w.order(PART).status).toBe('PART_BILLED');
    const page: any = await w.orders.getById(PART, ORG);
    expect(page).toMatchObject({ draftInvoice: null, canInvoice: true });
  });

  it('DOs only (no invoice): DO draft while an AIMS DO is open, DO completed, invoice pending once delivered; ERP DOs by their done flag', async () => {
    const w = world();
    // An imported order with nothing billed: its invoice unlinked.
    await w.orders.unlinkImportedDocument(PART, ORG, { type: 'INVOICE', id: I3 }, w.actor);
    await w.orders.linkImportedDocument(PART, ORG, { type: 'DELIVERY_ORDER', id: DE }, w.actor);
    expect(w.order(PART).linkedDocuments.do).toEqual([expect.objectContaining({ id: DE, imported: true, done: true })]);
    expect(w.order(PART).status).toBe('DO_COMPLETED');
    await w.orders.linkImportedDocument(PART, ORG, { type: 'DELIVERY_ORDER', id: DX }, w.actor);
    expect(w.order(PART).status).toBe('DO_DRAFT');
    w.doc(DX).status = 'delivered_installed';
    expect((await w.orders.getById(PART, ORG)).status).toBe('DO_COMPLETED');
    // An AIMS DO made on the order (Add DO) counts the same way.
    const r = await w.deliveries.prepareManualOrderDo(PART, ORG, { force: true, throwOnError: true });
    expect(w.order(PART).status).toBe('DO_DRAFT');
    w.doc(r!.doId).status = 'delivered';
    expect((await w.orders.getById(PART, ORG)).status).toBe('DO_COMPLETED');
    // The unlinked ERP invoice is remembered: a re-run of the import never links it back.
    expect(w.order(PART).linkedDocuments.imported.unlinked).toEqual([expect.objectContaining({ id: I3, type: 'INVOICE' })]);
    const plan = planImportedOrders([w.doc(Q2) as any, { ...w.doc(I3), config: { ...w.doc(I3).config, erpImport: { source: 'wct-erp', contractNo: '-014155 - x' } } } as any], {
      existingImported: new Map([[Q2, { ...(w.order(PART) as any) }]]),
    });
    expect(plan.updates.flatMap((u) => u.addInvoices)).toEqual([]);
    expect(plan.orders).toEqual([]);
  });

  it('a service report of the customer is linked as the order\'s report (attachment) and unlinked again', async () => {
    const w = world();
    await w.orders.linkImportedDocument(PAID, ORG, { type: 'SERVICE_REPORT', id: SR }, w.actor);
    expect(w.order(PAID).attachments).toEqual([expect.objectContaining({ kind: 'report', reportId: SR })]);
    const page: any = await w.orders.getById(PAID, ORG);
    expect(page.tracker.find((s: any) => s.key === 'serviceReport')).toMatchObject({ state: 'done', note: '#12' });
    await expect(w.orders.linkImportedDocument(PART, ORG, { type: 'SERVICE_REPORT', id: SR }, w.actor)).rejects.toThrow('Service report #12 is already on order ORD-Q-014154. A document can be on one order only.');
    await w.orders.unlinkImportedDocument(PAID, ORG, { type: 'SERVICE_REPORT', id: SR }, w.actor);
    expect(w.order(PAID).attachments).toEqual([]);
  });

  it('link options: the customer\'s documents by number, each with the order it is already on', async () => {
    const w = world();
    const opts: any[] = await w.orders.importedLinkOptions(PART, ORG, { type: 'INVOICE', q: 'I-0145' });
    expect(opts.map((o) => [o.name, o.onOrder?.orderNumber ?? null, o.onThisOrder])).toEqual([['I-014521', 'ORD-Q-014154', false]]);
    const all: any[] = await w.orders.importedLinkOptions(PART, ORG, { type: 'QUOTATION', q: '' });
    // Another customer's quotation is never offered.
    expect(all.map((o) => o.name).sort()).toEqual(['Q-014154', 'Q-014155', 'QO202611-0049', 'QO202611-0050']);
    expect(all.find((o) => o.name === 'Q-014155')).toMatchObject({ onThisOrder: true, onOrder: null });
    expect(all.find((o) => o.name === 'QO202611-0049')).toMatchObject({ onOrder: { id: NATIVE, orderNumber: 'ORD202611-020' } });
    const reports: any[] = await w.orders.importedLinkOptions(PART, ORG, { type: 'SERVICE_REPORT', q: '#12' });
    expect(reports.map((r) => r.name)).toEqual(['Service report #12']);
  });
});

describe('imported orders open (round 19): one order per document, Unlink rules', () => {
  it.each([
    ['an imported invoice on another imported order', 'INVOICE', I1, 'I-014521 is already on order ORD-Q-014154. A document can be on one order only.'],
    ['a quotation that is another order\'s own quotation', 'QUOTATION', Q1, 'Q-014154 is already on order ORD-Q-014154. A document can be on one order only.'],
    ['a native order\'s quotation', 'QUOTATION', QN, 'QO202611-0049 is already on order ORD202611-020. A document can be on one order only.'],
    ['a native order\'s invoice (its config.orderId and links)', 'INVOICE', IN, 'INV202611-0080 is already on order ORD202611-020. A document can be on one order only.'],
    ['the order\'s own quotation', 'QUOTATION', Q2, 'Q-014155 is already on this order.'],
  ])('refused: %s', async (_l, type, id, msg) => {
    const w = world();
    await expect(w.orders.linkImportedDocument(PART, ORG, { type, id }, w.actor)).rejects.toThrow(msg);
    expect(w.order(PART).linkedDocuments.quotation).toBeUndefined();
  });

  it('refused: a document of another customer, a voided one, an unknown type; a link already made elsewhere names that order', async () => {
    const w = world();
    await expect(w.orders.linkImportedDocument(PART, ORG, { type: 'QUOTATION', id: QO }, w.actor)).rejects.toThrow('QO202611-0051 is for another customer');
    w.doc(DX).config.cancelled = true;
    await expect(w.orders.linkImportedDocument(PART, ORG, { type: 'DO', id: DX }, w.actor)).rejects.toThrow(/voided or cancelled/);
    await expect(w.orders.linkImportedDocument(PART, ORG, { type: 'PO', id: QX }, w.actor)).rejects.toThrow(/Pick a quotation, invoice, DO or service report/);
    await w.orders.linkImportedDocument(PAID, ORG, { type: 'QUOTATION', id: QX }, w.actor);
    await expect(w.orders.linkImportedDocument(PART, ORG, { type: 'QUOTATION', id: QX }, w.actor)).rejects.toThrow('QO202611-0050 is already on order ORD-Q-014154. A document can be on one order only.');
    // A DO made on another order (config.orderId) is held by it.
    const r = await w.deliveries.prepareManualOrderDo(PAID, ORG, { force: true, throwOnError: true });
    await expect(w.orders.linkImportedDocument(PART, ORG, { type: 'DELIVERY_ORDER', id: r!.doId }, w.actor)).rejects.toThrow(/is already on order ORD-Q-014154/);
  });

  it('Unlink: never the order\'s own quotation, never an invoice made on the order', async () => {
    const w = world();
    await expect(w.orders.unlinkImportedDocument(PART, ORG, { type: 'QUOTATION', id: Q2 }, w.actor)).rejects.toThrow("The order's own quotation cannot be unlinked");
    const out = await w.documents.invoiceImportedOrderRemainder(PART, ORG, { lines: [{ description: 'x', quantity: 1, unitPrice: 10 }] });
    await expect(w.orders.unlinkImportedDocument(PART, ORG, { type: 'INVOICE', id: out.id }, w.actor)).rejects.toThrow(/was made on this order: void it instead/);
    await expect(w.orders.unlinkImportedDocument(PART, ORG, { type: 'QUOTATION', id: QX }, w.actor)).rejects.toThrow(/is not linked on this order/);
  });

  it('linking a quotation / DO is for imported orders only: a native order is refused and unchanged', async () => {
    const w = world();
    const before = JSON.stringify(w.order(NATIVE));
    await expect(w.orders.linkImportedDocument(NATIVE, ORG, { type: 'QUOTATION', id: QX }, w.actor)).rejects.toThrow(/orders imported from the old ERP/);
    // Unlink from order (round 24) takes a native order by the same rules: an invoice made on the order is refused.
    await expect(w.orders.unlinkImportedDocument(NATIVE, ORG, { type: 'INVOICE', id: IN }, w.actor)).rejects.toThrow('INV202611-0080 was made on this order: void it instead of unlinking it');
    await expect(w.orders.importedLinkOptions(NATIVE, ORG, { type: 'DELIVERY_ORDER' })).rejects.toThrow(/orders imported from the old ERP/);
    expect(JSON.stringify(w.order(NATIVE))).toBe(before);
    // Setting off: the imported order is hidden.
    const off = world({ ...ON, enableImportedOrders: false });
    await expect(off.orders.linkImportedDocument(PART, ORG, { type: 'QUOTATION', id: QX }, off.actor)).rejects.toThrow(/not found/i);
  });

  it('round 24: an AIMS order links / unlinks a service report (one order per report); quotations, invoices and DOs stay refused', async () => {
    const w = world();
    const opts: any[] = await w.orders.importedLinkOptions(NATIVE, ORG, { type: 'SERVICE_REPORT', q: '' });
    expect(opts.map((o) => [o.name, o.onOrder, o.onThisOrder])).toEqual([['Service report #12', null, false]]);
    const out = await w.orders.linkImportedDocument(NATIVE, ORG, { type: 'SERVICE_REPORT', id: SR }, w.actor);
    expect(out).toEqual({ type: 'SERVICE_REPORT', id: SR, name: 'Service report #12', orderNumber: 'ORD202611-020' });
    expect(w.order(NATIVE).attachments).toEqual([expect.objectContaining({ kind: 'report', reportId: SR, addedByName: 'Finance' })]);
    // The same one-order rule both ways.
    await expect(w.orders.linkImportedDocument(PART, ORG, { type: 'SERVICE_REPORT', id: SR }, w.actor)).rejects.toThrow('Service report #12 is already on order ORD202611-020. A document can be on one order only.');
    await expect(w.orders.linkImportedDocument(NATIVE, ORG, { type: 'SERVICE_REPORT', id: SR }, w.actor)).rejects.toThrow('Service report #12 is already on this order.');
    for (const type of ['QUOTATION', 'DELIVERY_ORDER']) {
      await expect(w.orders.linkImportedDocument(NATIVE, ORG, { type, id: QX }, w.actor)).rejects.toThrow('Only a service report (and, on the manual order flow, an invoice) can be linked to an order made in AIMS.');
      await expect(w.orders.importedLinkOptions(NATIVE, ORG, { type })).rejects.toThrow('Only a service report (and, on the manual order flow, an invoice) can be linked to an order made in AIMS.');
    }
    await w.orders.unlinkImportedDocument(NATIVE, ORG, { type: 'SERVICE_REPORT', id: SR }, w.actor);
    expect(w.order(NATIVE).attachments).toEqual([]);
    expect(w.order(NATIVE).linkedDocuments).toEqual({ po: [], do: [], invoice: [{ id: IN, name: 'INV202611-0080' }], salesOrder: [] });
    // An org without WCT orders: refused, nothing written.
    const off = world({ enableImportedOrders: true });
    await expect(off.orders.linkImportedDocument(NATIVE, ORG, { type: 'SERVICE_REPORT', id: SR }, off.actor)).rejects.toThrow('Only a service report (and, on the manual order flow, an invoice) can be linked to an order made in AIMS.');
    expect(off.order(NATIVE).attachments).toBeNull();
  });

  it('round 24: Link existing document puts an invoice on an AIMS order (manual flow): its links + invoiceDocumentId, status re-read, the invoice never written', async () => {
    const w = world();
    const opts: any[] = await w.orders.importedLinkOptions(NATIVE, ORG, { type: 'INVOICE', q: 'INV2026' });
    expect(opts.map((o) => [o.name, o.onOrder?.orderNumber ?? null, o.onThisOrder])).toEqual([['INV202611-0090', null, false], ['INV202611-0080', null, true]]);
    const out = await w.orders.linkImportedDocument(NATIVE, ORG, { type: 'INVOICE', id: IX }, w.actor);
    expect(out).toEqual({ type: 'INVOICE', id: IX, name: 'INV202611-0090', orderNumber: 'ORD202611-020' });
    expect(w.order(NATIVE).linkedDocuments.invoice).toEqual([{ id: IN, name: 'INV202611-0080' }, expect.objectContaining({ id: IX, name: 'INV202611-0090', total: 1090, linked: expect.objectContaining({ byName: 'Finance' }) })]);
    expect(w.order(NATIVE).invoiceDocumentId).toBe(IX);
    expect(docWrites(w, EXISTING_DOCS)).toEqual([]);
    const page: any = await w.orders.getById(NATIVE, ORG);
    expect(page.invoices.map((i: any) => i.name).sort()).toEqual(['INV202611-0080', 'INV202611-0090']);
    expect(page.summary).toMatchObject({ billed: 2180, owed: 2180 });
    // One order per invoice: another order is refused, naming this one; an order already holding an invoice keeps it.
    await expect(w.orders.linkImportedDocument(PART, ORG, { type: 'INVOICE', id: IX }, w.actor)).rejects.toThrow('INV202611-0090 is already on order ORD202611-020. A document can be on one order only.');
    // Off the manual flow (WCT Racking): a native order links service reports only.
    const racking = world({ ...ON, enableManualOrderFlow: false });
    await expect(racking.orders.linkImportedDocument(NATIVE, ORG, { type: 'INVOICE', id: IX }, racking.actor)).rejects.toThrow(/Only a service report/);
    expect(racking.order(NATIVE).linkedDocuments.invoice).toEqual([{ id: IN, name: 'INV202611-0080' }]);
  });

  it('round 24: Unlink from order on an AIMS order: a linked invoice comes off (with invoiceDocumentId); its own quotation, documents made on it and a job\'s invoice stay', async () => {
    const w = world();
    await w.orders.linkImportedDocument(NATIVE, ORG, { type: 'INVOICE', id: IX }, w.actor);
    let page: any = await w.orders.getById(NATIVE, ORG);
    expect(page.invoices.map((i: any) => [i.name, i.unlinkable, i.paid]).sort()).toEqual([['INV202611-0080', false, 0], ['INV202611-0090', true, 0]]);
    await expect(w.orders.unlinkImportedDocument(NATIVE, ORG, { type: 'QUOTATION', id: QN }, w.actor)).rejects.toThrow("The order's own quotation cannot be unlinked");
    await expect(w.orders.unlinkImportedDocument(NATIVE, ORG, { type: 'DELIVERY_ORDER', id: DX }, w.actor)).rejects.toThrow('DO202611050 is not linked on this order');
    const out = await w.orders.unlinkImportedDocument(NATIVE, ORG, { type: 'INVOICE', id: IX }, w.actor);
    expect(out).toEqual({ type: 'INVOICE', id: IX, name: 'INV202611-0090', orderNumber: 'ORD202611-020' });
    expect(w.order(NATIVE).linkedDocuments.invoice).toEqual([{ id: IN, name: 'INV202611-0080' }]);
    expect(w.order(NATIVE).invoiceDocumentId).toBeNull();
    expect(docWrites(w, EXISTING_DOCS)).toEqual([]);
    page = await w.orders.getById(NATIVE, ORG);
    expect(page.invoices.map((i: any) => i.name)).toEqual(['INV202611-0080']);
    // An invoice a job of the order is billed on stays (the job points at it).
    await w.orders.linkImportedDocument(NATIVE, ORG, { type: 'INVOICE', id: IX }, w.actor);
    w.db.delivery.push({ id: uid(90), organizationId: ORG, orderId: NATIVE, deliveryNumber: 31, status: 'completed', isDraft: false, orderInvoiceId: IX, createdAt: new Date(11) });
    await expect(w.orders.unlinkImportedDocument(NATIVE, ORG, { type: 'INVOICE', id: IX }, w.actor)).rejects.toThrow('INV202611-0090 bills job #31 of this order: void it instead of unlinking it');
    expect(w.order(NATIVE).linkedDocuments.invoice.map((x: any) => x.id)).toEqual([IN, IX]);
  });

  it('round 24: the AIMS order page carries the money summary and each invoice\'s date / owed (display only)', async () => {
    const w = world();
    const page: any = await w.orders.getById(NATIVE, ORG);
    expect(page.summary).toMatchObject({ quoteTotal: 1090, billed: 1090, billedPct: 100, owed: 1090, billingSteps: [{ label: '1 of 2', state: 'Unpaid' }] });
    expect(page.invoices).toEqual([expect.objectContaining({ id: IN, gross: 1090, owed: 1090, date: '2025-01-10' })]);
    expect(page.sourceQuotation).toMatchObject({ id: QN, name: 'QO202611-0049', total: 1090 });
    expect(page.subject).toBe('Degreasing');
    // The imported page keeps its own reading and also lists the quotation's supplier invoices.
    const imp: any = await w.orders.getById(PART, ORG);
    expect(imp).toMatchObject({ quoteTotal: 2616, billed: 1308, billedPct: 50 });
    expect(imp.supplierInvoices).toEqual({ rows: [], total: 0 });
  });

  it('pure helpers: holders, refusals, link lists (no mutation), unlinked remembered', () => {
    const o = { id: 'o1', orderNumber: 'ORD-Q-1', sourceQuotationId: 'q', linkedDocuments: { do: [{ id: 'd' }] }, attachments: [{ kind: 'report', reportId: 'r' }] };
    expect(orderHoldsDoc(o, 'QUOTATION', 'q')).toBe(true);
    expect(orderHoldsDoc(o, 'DELIVERY_ORDER', 'd')).toBe(true);
    expect(orderHoldsDoc(o, 'SERVICE_REPORT', 'r')).toBe(true);
    expect(orderHoldsDoc(o, 'INVOICE', 'x')).toBe(false);
    expect(holderRefusal('I-1', 'o1', [])).toBeNull();
    expect(holderRefusal('I-1', 'o1', [{ id: 'o1', orderNumber: 'ORD-Q-1' }])).toBe('I-1 is already on this order.');
    const ld = Object.freeze({ invoice: Object.freeze([{ id: 'i' }]), imported: Object.freeze({ source: IMPORTED_ORDER_SOURCE, unlinked: [{ id: 'e' }] }) });
    const stamp = { at: 't', by: 'u', byName: 'N' };
    const linked = withLinkedDocument(ld, 'DELIVERY_ORDER', { id: 'e', name: 'DO1', status: 'confirmed', config: { erpImport: { source: 'wct-erp', done: false } } }, stamp);
    expect(linked.do).toEqual([{ id: 'e', name: 'DO1', templateId: null, linked: stamp, imported: true, erpStatus: 'Issued', done: false, date: null }]);
    expect(linked.imported.unlinked).toEqual([]);
    const un = withoutLinkedDocument({ invoice: [{ id: 'i' }], creditNote: [{ id: 'c' }, { id: 'c2' }], imported: { source: IMPORTED_ORDER_SOURCE } }, 'INVOICE', 'i', { erp: true, creditNoteIds: ['c'], stamp });
    expect(un).toMatchObject({ invoice: [], creditNote: [{ id: 'c2' }], imported: { unlinked: [{ id: 'i', type: 'INVOICE', at: 't' }] } });
    expect(hasAimsLinks({ linkedDocuments: { invoice: [{ id: 'i' }], do: [{ id: 'd', imported: true }] } })).toBe(false);
    expect(hasAimsLinks({ linkedDocuments: { invoice: [{ id: 'i', native: true }] } })).toBe(true);
    expect(hasAimsLinks({ linkedDocuments: { quotation: [{ id: 'q' }] } })).toBe(true);
  });
});

describe('imported orders open (round 19): other orgs and native orders unchanged', () => {
  it('the list re-reads Paid orders holding AIMS links; Paid orders without them are not read (as before)', async () => {
    const w = world();
    const docsRead = jest.spyOn(w.prisma.document, 'findMany');
    await w.orders.list(ORG);
    const readIds = docsRead.mock.calls.flatMap(([a]: any) => a?.where?.id?.in ?? []);
    expect(readIds).not.toContain(I1);
    await w.orders.linkImportedDocument(PAID, ORG, { type: 'QUOTATION', id: QX }, w.actor);
    w.order(PAID).status = 'PAID'; // as if stored before the link
    const rows: any[] = await w.orders.list(ORG);
    expect(rows.find((r) => r.id === PAID)).toMatchObject({ status: 'PART_BILLED', statusLabel: 'Part billed' });
  });

  it('a quotation linked on an imported order gets no order of its own on accept; elsewhere nothing is read', async () => {
    const w = world({ ...ON, enableQuotationToDelivery: true });
    await w.orders.linkImportedDocument(PAID, ORG, { type: 'QUOTATION', id: QX }, w.actor);
    const run = await autoDraftDeliveryFromQuotation(w.prisma, ORG, QX);
    expect(run).toBeNull();
    expect(w.db.order).toHaveLength(3);
    expect(await importedOrderLinkingQuotation(w.prisma, ORG, QX)).toMatchObject({ id: PAID });
    // An org without imported orders: no order read at all.
    const other: any = { organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableWctOrders: true } })) }, order: { findFirst: jest.fn() } };
    expect(await importedOrderLinkingQuotation(other, OTHER, QX)).toBeNull();
    expect(other.order.findFirst).not.toHaveBeenCalled();
  });

  it('a native order\'s page, Add DO and status are as before (no imported fields)', async () => {
    const w = world();
    const page: any = await w.orders.getById(NATIVE, ORG);
    expect(page.imported).toBeUndefined();
    expect(page.deliveryOrders.every((d: any) => !('imported' in d))).toBe(true);
    const r = await w.deliveries.prepareManualOrderDo(NATIVE, ORG, { force: true, throwOnError: true });
    expect(w.doc(r!.doId).config.orderId).toBe(NATIVE);
    expect(w.order(NATIVE).linkedDocuments.quotation).toBeUndefined();
  });

  it('an imported order never invoices itself when its DOs complete (maybeInvoiceOrder); Invoice now names Create invoice', async () => {
    const w = world();
    expect(await w.documents.maybeInvoiceOrder(PAID, ORG)).toBeNull();
    await expect(w.documents.invoiceOrder(PAID, ORG, { trigger: 'now' })).rejects.toThrow(/bill it with Create invoice/);
  });
});
