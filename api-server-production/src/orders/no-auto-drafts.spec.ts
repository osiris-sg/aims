import { DocumentsService } from '../documents/documents.service';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { PublicSignService } from '../public-sign/public-sign.service';
import { DocumentNumberingService } from '../document-numbering/document-numbering.service';
import { DEFAULT_ORG_FEATURES } from '../organizations/default-features';
import { NO_AUTO_DRAFT_DO_FLAG, NO_AUTO_DRAFT_INVOICE_FLAG } from '../common/org-features';
import { MANUAL_ORDER_STATUS_LABEL, manualAutoDraftsOff } from './manual-order-flow';
import { splitInvoice } from '../documents/invoice-split-ops';

/**
 * No automatic drafts on manual-flow orders (2026-11-19, Elroy; WCT (S) + BC Air):
 *   disableAutoDraftDo       signing makes the order only, no draft DO
 *   disableAutoDraftInvoice  no draft invoice at signing, none when the last DO completes
 * The office adds the DO (Add DO) and the invoice (Create invoice) in either order. With the
 * flags off, and in every other org, signing still makes the draft DO + draft invoice and the
 * last DO still makes the draft invoice, exactly as before.
 */
const ORG = 'org-wct';
// As on prod for WCT (S) / BC Air (19 Nov), before the new flags.
const WCT_NOW = {
  enableWctOrders: true,
  enableManualOrderFlow: true,
  enableWctOrderInvoice: true,
  enableQuotationToDelivery: true,
  enableConfirmQuotation: true,
  enableQuotationESign: true,
  postInvoicesOnConfirm: true,
  enableInvoiceSplit: true,
};
const NO_DRAFTS = { ...WCT_NOW, disableAutoDraftDo: true, disableAutoDraftInvoice: true };
const RACKING = { enableWctOrders: true, enableWctOrderInvoice: true, enableQuotationToDelivery: true, enableConfirmQuotation: true, postInvoicesOnConfirm: true };
const ui = (features: any) => ({ organizationUIConfig: { findUnique: jest.fn(async () => ({ features })) } });

describe('flags', () => {
  it('two new keys, default OFF for every org', () => {
    expect(NO_AUTO_DRAFT_DO_FLAG).toBe('disableAutoDraftDo');
    expect(NO_AUTO_DRAFT_INVOICE_FLAG).toBe('disableAutoDraftInvoice');
    expect((DEFAULT_ORG_FEATURES as any).disableAutoDraftDo).toBe(false);
    expect((DEFAULT_ORG_FEATURES as any).disableAutoDraftInvoice).toBe(false);
  });

  it('only count on the manual order flow, each on its own', async () => {
    expect(await manualAutoDraftsOff(ui(NO_DRAFTS), ORG)).toEqual({ doOff: true, invoiceOff: true });
    expect(await manualAutoDraftsOff(ui({ ...WCT_NOW, disableAutoDraftDo: true }), ORG)).toEqual({ doOff: true, invoiceOff: false });
    expect(await manualAutoDraftsOff(ui({ ...WCT_NOW, disableAutoDraftInvoice: true }), ORG)).toEqual({ doOff: false, invoiceOff: true });
    for (const f of [WCT_NOW, RACKING, { ...RACKING, disableAutoDraftDo: true, disableAutoDraftInvoice: true }, { enableIdQuotation: true }, {}, { ...WCT_NOW, disableAutoDraftDo: 'true' }]) {
      expect(await manualAutoDraftsOff(ui(f), ORG)).toEqual({ doOff: false, invoiceOff: false });
    }
    expect(await manualAutoDraftsOff({ organizationUIConfig: { findUnique: async () => { throw new Error('db down'); } } }, ORG)).toEqual({ doOff: false, invoiceOff: false });
  });
});

// ── A small in-memory database: one order, its quotation, DOs and invoices ──
type Doc = { id: string; name: string | null; type: string; status: string; organizationId: string; documentTemplateId?: string | null; projectId?: string | null; config: any; createdAt: Date };

function inList(v: any, cond: any): boolean {
  if (cond === undefined) return true;
  if (cond && typeof cond === 'object' && Array.isArray(cond.in)) return cond.in.includes(v);
  if (cond && typeof cond === 'object' && 'not' in cond) return v !== cond.not;
  return v === cond;
}
function matches(d: Doc, where: any): boolean {
  if (!where) return true;
  if (!inList(d.id, where.id)) return false;
  if (!inList(d.type, where.type)) return false;
  if (!inList(d.name, where.name)) return false;
  if (where.organizationId && d.organizationId !== where.organizationId) return false;
  if (where.NOT?.id && inList(d.id, where.NOT.id)) return false;
  if (where.config?.path?.[0] === 'orderId' && d.config?.orderId !== where.config.equals) return false;
  if (where.config?.path?.[0] === 'sourceDocumentId' && d.config?.sourceDocumentId !== where.config.equals) return false;
  if (Array.isArray(where.OR) && !where.OR.some((w: any) => matches(d, { ...w, organizationId: where.organizationId }))) return false;
  return true;
}

function world(features: any, opts: { quoteLines?: any[] } = {}) {
  const docs = new Map<string, Doc>();
  let t = 0;
  const add = (d: Partial<Doc> & { id: string; type: string }) => {
    const row: Doc = { name: null, status: 'draft', organizationId: ORG, documentTemplateId: 'tpl', projectId: null, config: {}, createdAt: new Date(Date.UTC(2026, 10, 19, 0, 0, t++)), ...d } as Doc;
    docs.set(row.id, row);
    return row;
  };
  add({
    id: 'q1',
    type: 'QUOTATION',
    name: 'QO202611-0050',
    status: 'confirmed',
    config: {
      customerName: 'TEST Client',
      customer: { id: 'c1', name: 'TEST Client' },
      billTo: '1 Test Road',
      gstPercent: 9,
      taxApplicable: 'Y',
      items: opts.quoteLines ?? [{ description: 'Chemical degreasing of hood', quantity: 1, unitPrice: 800, amount: 800 }],
    },
  });
  const order: any = {
    id: 'o1',
    organizationId: ORG,
    orderNumber: 'ORD202611-050',
    status: 'QUOTATION_SIGNED',
    statusDates: null,
    createdAt: new Date('2026-11-19T01:00:00Z'),
    sourceQuotationId: 'q1',
    invoiceDocumentId: null,
    linkedDocuments: { po: [], do: [], invoice: [], salesOrder: [] },
  };
  const created: Doc[] = [];
  const db: any = {
    ...ui(features),
    order: {
      findFirst: jest.fn(async () => order),
      update: jest.fn(async ({ data }: any) => Object.assign(order, data)),
    },
    document: {
      findFirst: jest.fn(async ({ where }: any) => [...docs.values()].find((d) => matches(d, where)) ?? null),
      findMany: jest.fn(async ({ where }: any) => [...docs.values()].filter((d) => matches(d, where)).sort((a, b) => +a.createdAt - +b.createdAt)),
      update: jest.fn(async ({ where, data }: any) => {
        const d = docs.get(where.id)!;
        if (data.config) d.config = data.config;
        if (data.name) d.name = data.name;
        if (data.status) d.status = data.status;
        return d;
      }),
      create: jest.fn(async ({ data }: any) => {
        const d = add({ ...data });
        created.push(d);
        return d;
      }),
    },
    delivery: { findMany: jest.fn(async () => []), updateMany: jest.fn(async () => ({ count: 0 })), findFirst: jest.fn(async () => null) },
    deliveryItem: { findMany: jest.fn(async () => []) },
    organization: { findUnique: jest.fn(async () => ({ taxRate: 9, taxApplicable: true })) },
    accountingSetting: { findUnique: jest.fn(async () => ({ timeZone: 'Asia/Singapore' })) },
    asset: { findMany: jest.fn(async () => []) },
    maintenanceServiceReport: { updateMany: jest.fn(async () => ({ count: 0 })) },
    payment: { count: jest.fn(async () => 0) },
    journalEntry: { findMany: jest.fn(async () => []) },
    $executeRawUnsafe: jest.fn(async () => 1),
  };
  db.$transaction = jest.fn(async (fn: any) => (typeof fn === 'function' ? fn(db) : fn));

  const svc: any = Object.create(DocumentsService.prototype);
  svc.prisma = db;
  let invNo = 30;
  const dosOf = () => [...docs.values()].filter((d) => d.type === 'DELIVERY_ORDER' && d.config?.orderId === 'o1' && d.config?.cancelled !== true);
  svc.deliveriesService = {
    orderDos: jest.fn(async () => dosOf()),
    jobsOnDo: jest.fn(async () => []),
    // Add DO / the DO at signing: a draft DO with the quotation's line (DeliveriesService.prepareManualOrderDo).
    prepareManualOrderDo: jest.fn(async () => {
      const n = 40 + dosOf().length;
      const d = add({ id: `do${n}`, type: 'DELIVERY_ORDER', name: `DO2026110${n}`, status: 'unconfirmed', config: { orderId: 'o1', customerName: 'TEST Client', billTo: '1 Test Road', items: [{ description: 'Chemical degreasing of hood', quantity: 1 }] } });
      created.push(d);
      return { doId: d.id, doName: d.name };
    }),
  };
  svc.resolveTemplateIdForType = jest.fn(async () => 'tpl-inv');
  svc.createBasicDocument = jest.fn(async (_t: string, type: string, _o: string, config: any) => {
    const d = add({ id: `inv${invNo}`, type, name: `INV202611-00${invNo++}`, status: 'draft', documentTemplateId: 'tpl-inv', config });
    created.push(d);
    return d;
  });
  svc.repostGlForDocument = jest.fn(async () => undefined);
  svc.priceInvoiceLinesFromAsset = jest.fn(async (lines: any[]) => lines.map((l) => ({ unitPrice: 50, ...l })));
  svc.notifications = { emit: jest.fn(async () => undefined) };
  svc.staffWhatsApp = { push: jest.fn(async () => undefined) };
  svc.logDocumentEvent = jest.fn(async () => undefined);

  const addDo = () => svc.deliveriesService.prepareManualOrderDo('o1', ORG);
  const complete = (id: string) => Object.assign(docs.get(id)!, { status: 'delivered_installed' });
  const invoices = () => [...docs.values()].filter((d) => d.type === 'INVOICE');
  const createInvoice = () => svc.invoiceOrder('o1', ORG, { trigger: 'now' });
  return { svc: svc as any, db, order, docs, created, addDo, complete, invoices, createInvoice };
}

describe('signing: both sign paths call DocumentsService.prepareManualOrderDo', () => {
  it('flags ON: the order only (no DO, no invoice); the order reads "Quotation signed"', async () => {
    const w = world(NO_DRAFTS);
    w.order.status = 'OPEN'; // as the new order row is made
    expect(await w.svc.prepareManualOrderDo('o1', ORG)).toBeNull();
    expect(w.svc.deliveriesService.prepareManualOrderDo).not.toHaveBeenCalled();
    expect(w.svc.createBasicDocument).not.toHaveBeenCalled();
    expect(w.created).toEqual([]);
    expect(w.order.status).toBe('QUOTATION_SIGNED');
    expect(MANUAL_ORDER_STATUS_LABEL[w.order.status as 'QUOTATION_SIGNED']).toBe('Quotation signed');
  });

  it('only disableAutoDraftDo: the draft invoice, no DO (Invoice draft, DO pending)', async () => {
    const w = world({ ...WCT_NOW, disableAutoDraftDo: true });
    await w.svc.prepareManualOrderDo('o1', ORG);
    expect(w.svc.deliveriesService.prepareManualOrderDo).not.toHaveBeenCalled();
    expect(w.invoices()).toHaveLength(1);
    expect(w.order.status).toBe('INVOICE_DRAFT_DO_PENDING');
  });

  it('only disableAutoDraftInvoice: the draft DO, no invoice (DO draft)', async () => {
    const w = world({ ...WCT_NOW, disableAutoDraftInvoice: true });
    expect(await w.svc.prepareManualOrderDo('o1', ORG)).toEqual({ doId: 'do40', doName: 'DO202611040' });
    expect(w.invoices()).toHaveLength(0);
    expect(w.order.status).toBe('DO_DRAFT');
  });

  it('flags OFF (WCT (S) / BC Air today): draft DO + draft invoice, as before', async () => {
    const w = world(WCT_NOW);
    expect(await w.svc.prepareManualOrderDo('o1', ORG)).toEqual({ doId: 'do40', doName: 'DO202611040' });
    expect(w.svc.deliveriesService.prepareManualOrderDo).toHaveBeenCalledWith('o1', ORG);
    expect(w.invoices()).toHaveLength(1);
    expect(w.invoices()[0].config).toMatchObject({ orderInvoicedFirst: true, deliveryOrderNos: ['DO202611040'] });
  });

  it('other orgs (Racking, plain WCT orders) with the keys set by mistake: unchanged (no invoice at signing, DO prepare as before)', async () => {
    for (const f of [RACKING, { ...RACKING, disableAutoDraftDo: true, disableAutoDraftInvoice: true }]) {
      const w = world(f);
      await w.svc.prepareManualOrderDo('o1', ORG);
      expect(w.svc.deliveriesService.prepareManualOrderDo).toHaveBeenCalledWith('o1', ORG);
      expect(w.svc.createBasicDocument).not.toHaveBeenCalled();
    }
  });
});

describe('the customer e-sign link (PublicSignService.sign), end to end with the real order hook', () => {
  const sign = async (features: any) => {
    const w = world(features);
    let order: any = null;
    const db = w.db;
    db.order.findFirst = jest.fn(async () => order);
    db.order.create = jest.fn(async ({ data }: any) => (order = { id: 'o1', createdAt: new Date('2026-11-19T01:00:00Z'), statusDates: null, invoiceDocumentId: null, ...data }));
    db.order.update = jest.fn(async ({ data }: any) => Object.assign(order, data));
    db.documentNumberFormat = { findFirst: jest.fn(async () => ({ id: 'fmt' })) };
    db.customer = { findFirst: jest.fn(async () => ({ id: 'c1' })) };
    db.documentSignLink = { update: jest.fn(), updateMany: jest.fn() };
    db.delivery.create = jest.fn();
    jest.spyOn(DocumentNumberingService.prototype, 'issueNumberLocked').mockResolvedValue('ORD202611-050' as any);
    const s: any = Object.create(PublicSignService.prototype);
    const quotation = w.docs.get('q1')!;
    s.resolve = async () => ({ link: { id: 'l1', document: { ...quotation, status: 'draft', projectId: null } }, state: 'active' });
    s.assertHasPricedLines = () => undefined;
    s.prisma = db;
    w.svc.getOrGeneratePdfUrl = jest.fn(async () => 'url');
    w.svc.prepareManualOrderJob = jest.fn(async () => null);
    w.svc.generateSequentialDocumentName = jest.fn(async () => null);
    s.documents = w.svc;
    const pushes: string[] = [];
    s.staffWhatsApp = { push: async (_o: string, text: string) => void pushes.push(text) };
    s.notifications = { emit: async () => undefined };
    const logs: any[] = [];
    s.actionLog = { log: async (e: any) => void logs.push(e) };
    s.logger = { log: () => undefined, warn: () => undefined };
    await s.sign('tok', { signerName: 'Alice', agreed: true, signatureDataUrl: 'data:image/png;base64,AAAA' }, { ip: '1.2.3.4' });
    return { w, order: () => order, pushes, logs };
  };
  afterEach(() => jest.restoreAllMocks());

  it('flags ON: one order, no DO, no invoice, no job; staff told to add them; the signature is logged with the order', async () => {
    const { w, order, pushes, logs } = await sign(NO_DRAFTS);
    expect(order()).toMatchObject({ orderNumber: 'ORD202611-050', sourceQuotationId: 'q1', status: 'QUOTATION_SIGNED' });
    expect(w.svc.deliveriesService.prepareManualOrderDo).not.toHaveBeenCalled();
    expect(w.svc.createBasicDocument).not.toHaveBeenCalled();
    expect(w.db.delivery.create).not.toHaveBeenCalled();
    expect(w.created).toEqual([]);
    expect(pushes[0]).toContain('Order ORD202611-050 created: add the DO and create the invoice from the order page.');
    expect(pushes[0]).not.toContain('draft DO');
    expect(logs).toEqual([expect.objectContaining({ action: 'SIGN', details: expect.objectContaining({ orderNumber: 'ORD202611-050' }) })]);
  });

  it('flags OFF: the order, its draft DO and its draft invoice, message as before', async () => {
    const { w, order, pushes } = await sign(WCT_NOW);
    expect(order().sourceQuotationId).toBe('q1');
    expect(w.svc.deliveriesService.prepareManualOrderDo).toHaveBeenCalledTimes(1);
    expect(w.invoices()).toHaveLength(1);
    expect(pushes[0]).toContain('Order ORD202611-050 created with draft DO DO202611040: complete the DO when the work is done');
  });
});

describe('flags ON: Add DO and Create invoice, in either order', () => {
  it('Add DO, then Create invoice (header from the DO), then the DO completes: linked, no second invoice', async () => {
    const w = world(NO_DRAFTS);
    await w.addDo();
    await w.createInvoice();
    expect(w.invoices()).toHaveLength(1);
    expect(w.invoices()[0].config).toMatchObject({ orderInvoicedFirst: true, orderBillsQuote: true, deliveryOrderNos: ['DO202611040'], billTo: '1 Test Road' });
    expect(w.order.status).toBe('INVOICE_DRAFT_DO_PENDING');
    w.complete('do40');
    const out = await w.svc.maybeInvoiceOrder('o1', ORG);
    expect(out).toMatchObject({ id: 'inv30', covered: true });
    expect(w.invoices()).toHaveLength(1);
    expect(w.docs.get('do40')!.config.orderInvoiceId).toBe('inv30');
    expect(w.order.status).toBe('INVOICE_DRAFT');
  });

  it('Create invoice with no DO at all (header from the quotation), then Add DO, then the DO completes', async () => {
    const w = world(NO_DRAFTS);
    await w.createInvoice();
    expect(w.invoices()).toHaveLength(1);
    expect(w.invoices()[0].config).toMatchObject({ customerName: 'TEST Client', billTo: '1 Test Road', deliveryOrderNos: [], orderInvoicedFirst: true });
    expect(w.order.status).toBe('INVOICE_DRAFT_DO_PENDING');
    expect(MANUAL_ORDER_STATUS_LABEL.INVOICE_DRAFT_DO_PENDING).toBe('Invoice draft, DO pending');
    await w.addDo();
    w.complete('do40');
    await w.svc.maybeInvoiceOrder('o1', ORG);
    expect(w.invoices()).toHaveLength(1);
    expect(w.docs.get('do40')!.config.orderInvoiceId).toBe('inv30');
    expect(w.order.status).toBe('INVOICE_DRAFT');
  });

  it('Create invoice twice opens the first, never a second', async () => {
    const w = world(NO_DRAFTS);
    await w.createInvoice();
    expect(await w.createInvoice()).toMatchObject({ id: 'inv30', existing: true });
    expect(w.invoices()).toHaveLength(1);
  });

  it('split payment on the invoice made by Create invoice; the DO completing links to the parts', async () => {
    const w = world(NO_DRAFTS);
    await w.createInvoice();
    const r: any = await splitInvoice(w.db, ORG, 'inv30', { mode: 'rate', parts: [30, 70] }, undefined, async () => undefined);
    expect(r.parts.map((p: any) => p.name)).toEqual(['INV202611-0030-1', 'INV202611-0030-2']);
    expect(w.order.linkedDocuments.invoice.map((x: any) => x.name)).toEqual(['INV202611-0030-1', 'INV202611-0030-2']);
    await w.addDo();
    w.complete('do40');
    await w.svc.maybeInvoiceOrder('o1', ORG);
    expect(w.invoices()).toHaveLength(2); // the two parts, nothing new
    expect(w.docs.get('do40')!.config.orderInvoiceId).toBe('inv30');
    expect(w.order.status).toBe('INVOICE_DRAFT');
  });
});

describe('the last DO completes', () => {
  it('flags ON, no invoice yet: no draft invoice; "DO completed, invoice pending"; Create invoice then bills it', async () => {
    const w = world(NO_DRAFTS);
    await w.addDo();
    w.complete('do40');
    expect(await w.svc.maybeInvoiceOrder('o1', ORG)).toBeNull();
    expect(w.invoices()).toHaveLength(0);
    expect(w.docs.get('do40')!.config.orderInvoiceId).toBeUndefined(); // the claim was handed back
    expect(w.order.status).toBe('DO_COMPLETED');
    expect(MANUAL_ORDER_STATUS_LABEL.DO_COMPLETED).toBe('DO completed, invoice pending');
    const inv = await w.createInvoice();
    expect(inv).toMatchObject({ id: 'inv30' });
    expect(w.invoices()[0].config).toMatchObject({ orderBillsQuote: true, deliveryOrderNos: ['DO202611040'] });
    expect(w.docs.get('do40')!.config.orderInvoiceId).toBe('inv30');
    expect(w.order.status).toBe('INVOICE_DRAFT');
  });

  it('flags ON, the DO completed through createInvoiceFromDeliveryOrder (Complete DO / sign link): no invoice either', async () => {
    const w = world(NO_DRAFTS);
    await w.addDo();
    w.complete('do40');
    expect(await w.svc.createInvoiceFromDeliveryOrder('do40', ORG)).toBeNull();
    expect(w.invoices()).toHaveLength(0);
    expect(w.order.status).toBe('DO_COMPLETED');
  });

  it('flags ON, invoice first and lines beyond the quotation on the DO: no automatic extra draft; Create invoice bills them', async () => {
    const w = world(NO_DRAFTS);
    await w.createInvoice();
    await w.addDo();
    w.docs.get('do40')!.config.items.push({ description: 'Extra filter', quantity: 1 });
    w.complete('do40');
    expect(await w.svc.maybeInvoiceOrder('o1', ORG)).toBeNull();
    expect(w.invoices()).toHaveLength(1);
    expect(w.docs.get('do40')!.config.orderInvoiceId).toBeUndefined();
    expect(w.order.status).toBe('DO_COMPLETED');
    await w.createInvoice();
    expect(w.invoices()).toHaveLength(2);
    expect(w.invoices()[1].config).toMatchObject({ orderBillsQuote: false });
    expect(w.invoices()[1].config.items.map((l: any) => l.description)).toEqual(['Extra filter']);
  });

  it('flags OFF (as before): the last DO makes the draft invoice by itself', async () => {
    const w = world(WCT_NOW);
    await w.addDo();
    w.complete('do40');
    expect(await w.svc.maybeInvoiceOrder('o1', ORG)).toMatchObject({ id: 'inv30' });
    expect(w.invoices()).toHaveLength(1);
    expect(w.docs.get('do40')!.config.orderInvoiceId).toBe('inv30');
    expect(w.order.status).toBe('INVOICE_DRAFT');
  });

  it('flags OFF (as before): invoice first + extra lines on the DO make the "Extra invoice draft" by itself', async () => {
    const w = world(WCT_NOW);
    await w.createInvoice();
    await w.addDo();
    w.docs.get('do40')!.config.items.push({ description: 'Extra filter', quantity: 1 });
    w.complete('do40');
    await w.svc.maybeInvoiceOrder('o1', ORG);
    expect(w.invoices()).toHaveLength(2);
    expect(w.invoices()[1].config).toMatchObject({ orderBillsQuote: false });
  });

  it('flags OFF: maybeInvoiceOrder calls invoiceOrder exactly as before ({ trigger: "auto" })', async () => {
    const w = world(WCT_NOW);
    await w.addDo();
    w.complete('do40');
    const spy = jest.spyOn(w.svc, 'invoiceOrder');
    await w.svc.maybeInvoiceOrder('o1', ORG);
    expect(spy).toHaveBeenCalledWith('o1', ORG, { trigger: 'auto' });
  });
});

describe('Add DO with no DO made at signing: calendar jobs waiting on the quotation go on it', () => {
  const make = (features: any) => {
    const s: any = Object.create(DeliveriesService.prototype);
    s.prisma = {
      ...ui(features),
      order: { findFirst: jest.fn(async () => ({ id: 'o1', status: 'QUOTATION_SIGNED', customerId: null, sourceQuotationId: null, linkedDocuments: {}, orderNumber: 'ORD202611-050' })) },
      document: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      delivery: { findMany: jest.fn(async () => []) },
    };
    s.logger = { warn: () => undefined, log: () => undefined };
    s.orderDos = jest.fn(async () => []);
    s.orderLinesInUse = jest.fn(async () => []);
    s.resolveDeliveryOrderTemplateId = jest.fn(async () => 'tpl-do');
    s.attachWaitingJobsToDo = jest.fn(async () => undefined);
    s.documentsService = { createNumberedDeliveryOrder: jest.fn(async () => ({ id: 'do40', name: 'DO202611040' })) };
    return s;
  };
  it('flags ON: the Add DO (force) attaches them', async () => {
    const s = make(NO_DRAFTS);
    expect(await s.prepareManualOrderDo('o1', ORG, { force: true, throwOnError: true })).toMatchObject({ doId: 'do40' });
    expect(s.attachWaitingJobsToDo).toHaveBeenCalledWith(ORG, 'o1');
  });
  it('flags OFF: Add DO as before (the DO made at signing took them)', async () => {
    const s = make(WCT_NOW);
    await s.prepareManualOrderDo('o1', ORG, { force: true, throwOnError: true });
    expect(s.attachWaitingJobsToDo).not.toHaveBeenCalled();
  });
});
