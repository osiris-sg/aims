jest.mock('../orders/wct-orders', () => {
  const counters: Record<string, number> = {};
  return {
    ensureOrderNumberFormat: async () => ({ id: 'fmt' }),
    issueOrderNumberInTx: async (_p: any, _tx: any, org: string) => {
      counters[org] = (counters[org] ?? 0) + 1;
      return `${org === BC ? 'ORDB' : 'ORDW'}202611-${String(100 + counters[org]).padStart(3, '0')}`;
    },
    refreshOrderStatus: jest.fn(async () => null),
  };
});
jest.mock('../orders/imported-orders', () => ({ isImportedOrder: (o: any) => !!o?.linkedDocuments?.imported }));

import { randomUUID } from 'crypto';
import { DocumentNumberingService } from '../document-numbering/document-numbering.service';
import {
  creditNoteConfig,
  gstSwitchStateOf,
  invoiceIsGst,
  matchCustomer,
  movedConfig,
  newDocumentTaxDefault,
  orderLinksAfterMove,
  planUnit,
  taxedInvoiceConfig,
} from './gst-switch';
import { GstSwitchService } from './gst-switch.service';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const BC = '5c700000-0000-4000-8000-5c7000000004';
const RK = '5c700000-0000-4000-8000-5c7000000002';
const ON = { enableWctOrders: true, enableManualOrderFlow: true };

/** GST switch with company move (WCT group, 2026-11-24). */
describe('gst switch: which companies', () => {
  const group = [
    { id: WCT, name: 'WCT (S) Systems Pte Ltd', parentOrgId: null, features: ON },
    { id: BC, name: 'BC AIR PTE. LTD.', parentOrgId: WCT, features: ON },
    { id: RK, name: 'WCT Racking', parentOrgId: WCT, features: { enableWctOrders: true } },
  ];
  it('WCT (S) = GST, partner BC Air; BC Air = non-GST, partner WCT (S); Racking off', () => {
    expect(gstSwitchStateOf(WCT, group)).toEqual({ on: true, gst: true, partner: { id: BC, name: 'BC AIR PTE. LTD.' } });
    expect(gstSwitchStateOf(BC, group)).toEqual({ on: true, gst: false, partner: { id: WCT, name: 'WCT (S) Systems Pte Ltd' } });
    expect(gstSwitchStateOf(RK, group).on).toBe(false);
  });
  it('off: outside a group, a kill switch, or two possible partners', () => {
    expect(gstSwitchStateOf('x', [{ id: 'x', name: 'Solo', parentOrgId: null, features: ON }]).on).toBe(false);
    expect(gstSwitchStateOf(WCT, [{ ...group[0], features: { ...ON, gstSwitchOff: true } }, group[1]]).on).toBe(false);
    expect(gstSwitchStateOf(WCT, [...group, { id: 'y', name: 'Y', parentOrgId: WCT, features: ON }]).on).toBe(false);
    expect(gstSwitchStateOf(WCT, []).on).toBe(false);
  });
});

describe('gst switch: pure rules', () => {
  const cfg = { gstPercent: 9, taxApplicable: 'Y', absorbTax: 'N', items: [{ description: 'Hood', amount: 1000 }], nettTotal: 1090, outstandingBalance: 1090 };
  it('non-GST / GST invoice totals', () => {
    const n = taxedInvoiceConfig(cfg, false);
    expect([n.taxApplicable, n.subTotal, n.gstAmount, n.nettTotal, n.outstandingBalance, n.documentInfo.taxApplicable]).toEqual(['N', 1000, 0, 1000, 1000, 'N']);
    const g = taxedInvoiceConfig(n, true);
    expect([g.taxApplicable, g.gstAmount, g.nettTotal, g.outstandingBalance]).toEqual(['Y', 90, 1090, 1090]);
    expect(invoiceIsGst(n)).toBe(false);
    expect(invoiceIsGst(g)).toBe(true);
  });
  it('moved config: new number, customer, renamed links, Previously', () => {
    const out = movedConfig(
      { documentNumber: 'INV1', documentInfo: { documentNumber: 'INV1' }, customerId: 'c1', customer: { id: 'c1', customerCode: 'CA001' }, orderNo: 'ORDW1', deliveryOrderNos: ['DO1'], sourceDocumentNumber: 'QO1', linkedDocs: [{ id: 'd', type: 'DELIVERY_ORDER', name: 'DO1' }] },
      { number: 'INV9', previousNumber: 'INV1', from: { id: WCT, name: 'WCT' }, to: { id: BC, name: 'BC Air' }, customer: { id: 'c9', name: 'TEST Client', customerCode: 'CT009' }, renames: new Map([['DO1', 'DO9'], ['QO1', 'QO9']]), orderNumber: 'ORDB1', at: 'now', by: 'me' },
    );
    expect(out).toMatchObject({ documentNumber: 'INV9', documentInfo: { documentNumber: 'INV9' }, customerId: 'c9', customer: { id: 'c9', customerCode: 'CT009' }, orderNo: 'ORDB1', deliveryOrderNos: ['DO9'], sourceDocumentNumber: 'QO9', linkedDocs: [{ name: 'DO9' }], previousNumber: 'INV1' });
    expect(out.movedFrom).toEqual([{ orgId: WCT, orgName: 'WCT', number: 'INV1', at: 'now', by: 'me', reason: 'gst-switch' }]);
  });
  it('credit note: full credit of the invoice, references it, no order keys', () => {
    const cn = creditNoteConfig({ id: 'i1', name: 'INV1', config: { ...cfg, orderId: 'o', orderNo: 'ORDW1', payToken: 't' } }, { date: '2026-11-24', to: { id: BC, name: 'BC Air' }, gstLabel: 'Non-GST invoice' });
    expect(cn).toMatchObject({ sourceDocumentId: 'i1', sourceDocumentType: 'INVOICE', sourceDocumentNumber: 'INV1', nettTotal: 1090, outstandingBalance: 1090 });
    expect(cn.orderId).toBeUndefined();
    expect(cn.payToken).toBeUndefined();
  });
  it('order links: renamed, credited invoice swapped for its re-issue, the credit recorded', () => {
    const ld = orderLinksAfterMove(
      { quotation: [{ id: 'q', name: 'QO1', templateId: 't1' }], do: [{ id: 'd', name: 'DO1', orderInvoiceId: 'i1' }], invoice: [{ id: 'i1', name: 'INV1' }] },
      { renames: new Map([['QO1', 'QO9'], ['DO1', 'DO9']]), reissued: [{ oldId: 'i1', oldName: 'INV1', newId: 'i9', newName: 'INV9', creditNoteId: 'cn', creditNoteName: 'CN1', templateId: 'tI' }], from: { id: WCT, name: 'WCT' }, previousOrderNumber: 'ORDW1', at: 'now', templateOf: () => 'tB' },
    );
    expect(ld.quotation[0]).toMatchObject({ id: 'q', name: 'QO9', templateId: 'tB' });
    expect(ld.do[0]).toMatchObject({ name: 'DO9', orderInvoiceId: 'i9' });
    expect(ld.invoice[0]).toMatchObject({ id: 'i9', name: 'INV9', reissuedFrom: { id: 'i1', name: 'INV1' } });
    expect(ld.crossOrgCredit[0]).toMatchObject({ invoiceId: 'i1', creditNoteName: 'CN1', reissuedName: 'INV9' });
    expect(ld.movedFrom[0]).toMatchObject({ orderNumber: 'ORDW1' });
  });
  it('plan: drafts move, confirmed invoices are credited, a payment / credit note blocks', () => {
    const docs = [
      { id: 'q', type: 'QUOTATION', name: 'QO1', status: 'confirmed', config: {} },
      { id: 'i1', type: 'INVOICE', name: 'INV1', status: 'pending_payment', config: {} },
      { id: 'i2', type: 'INVOICE', name: 'INV2', status: 'draft', config: {} },
    ];
    const none = { payments: new Set<string>(), liveJournals: new Set<string>(), otherCredits: new Set<string>() };
    const p = planUnit(docs, none);
    expect([p.blocked, p.move.map((d) => d.id), p.credit.map((d) => d.id)]).toEqual([null, ['q', 'i2'], ['i1']]);
    expect(planUnit(docs, { ...none, payments: new Set(['i1']) }).blocked).toBe('INV1 has a payment or an allocation. Nothing was changed.');
    expect(planUnit(docs, { ...none, otherCredits: new Set(['i1']) }).blocked).toContain('has a credit note');
    expect(planUnit(docs, { ...none, liveJournals: new Set(['q']) }).blocked).toContain('ledger entry');
    expect(planUnit([{ ...docs[2], config: { erpImport: {} } }], none).blocked).toContain('imported');
    // A retry: the invoice already credited by this switch (its offset is a payment) is not blocked again.
    expect(planUnit([{ ...docs[1], config: { gstMove: { creditNote: { id: 'cn' } } } }], { ...none, payments: new Set(['i1']) }).credit.length).toBe(1);
  });
  it('customer: UEN first, then exact name, else none', () => {
    const t = [{ id: 'a', name: 'TEST Client', uen: null }, { id: 'b', name: 'Other', uen: '200000000A' }];
    expect(matchCustomer({ name: 'x', uen: '200000000a' }, t)?.id).toBe('b');
    expect(matchCustomer({ name: ' TEST  Client ', uen: null }, t)?.id).toBe('a');
    expect(matchCustomer({ name: 'test client', uen: null }, t)).toBeNull();
  });
});

// ── An in-memory database for the service tests ──────────────────────────────
type Row = Record<string, any>;
function match(row: Row, where: any): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (k === 'OR') {
      if (!(cond as any[]).some((w) => match(row, w))) return false;
      continue;
    }
    if (k === 'AND') {
      if (!(cond as any[]).every((w) => match(row, w))) return false;
      continue;
    }
    const v = row[k];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const c: any = cond;
      if ('path' in c) {
        const got = c.path.reduce((o: any, p: string) => (o == null ? undefined : o[p]), v);
        if (got !== c.equals) return false;
        continue;
      }
      if ('in' in c && !c.in.includes(v)) return false;
      if ('not' in c && v === c.not) return false;
      if ('startsWith' in c && !(typeof v === 'string' && v.startsWith(c.startsWith))) return false;
      if ('equals' in c && (c.mode === 'insensitive' ? String(v ?? '').toLowerCase() !== String(c.equals).toLowerCase() : v !== c.equals)) return false;
      continue;
    }
    if (v !== cond) return false;
  }
  return true;
}
function table(rows: Row[]) {
  const pick = (r: Row | undefined) => (r ? JSON.parse(JSON.stringify(r)) : null);
  return {
    rows,
    findFirst: async (a: any = {}) => pick(rows.find((r) => match(r, a.where))),
    findUnique: async (a: any = {}) => pick(rows.find((r) => match(r, a.where))),
    findMany: async (a: any = {}) => rows.filter((r) => match(r, a.where)).map(pick),
    count: async (a: any = {}) => rows.filter((r) => match(r, a.where)).length,
    create: async (a: any) => {
      const r = { id: a.data.id ?? randomUUID(), ...a.data };
      rows.push(r);
      return pick(r);
    },
    update: async (a: any) => {
      const r = rows.find((x) => match(x, a.where));
      if (!r) throw new Error('not found');
      Object.assign(r, JSON.parse(JSON.stringify(a.data)));
      return pick(r);
    },
    updateMany: async (a: any) => {
      const hit = rows.filter((x) => match(x, a.where));
      for (const r of hit) Object.assign(r, a.data);
      return { count: hit.length };
    },
    aggregate: async (a: any) => {
      const hit = rows.filter((x) => match(x, a.where));
      const key = Object.keys(a._max)[0];
      return { _max: { [key]: hit.length ? Math.max(...hit.map((r) => Number(r[key]) || 0)) : null } };
    },
  };
}

function world(opts: { confirmed?: boolean; payment?: boolean } = {}) {
  const db: any = {
    organization: table([
      { id: WCT, name: 'WCT (S) Systems Pte Ltd', parentOrgId: null, address: 'W addr', phoneNumber: '1', registrationNumber: 'W-UEN', taxRate: 9 },
      { id: BC, name: 'BC AIR PTE. LTD.', parentOrgId: WCT, address: 'B addr', phoneNumber: '2', registrationNumber: '202205130K', taxRate: 9 },
    ]),
    organizationUIConfig: table([
      { organizationId: WCT, features: ON },
      { organizationId: BC, features: { ...ON, serviceReportTemplate: 'BCAIR' } },
    ]),
    customer: table([{ id: 'cw', organizationId: WCT, name: 'TEST Client', uen: null, email: 'x@test', phone: null, address: null, gstRegNo: null, customerCode: 'CT001' }]),
    document: table([]),
    order: table([]),
    delivery: table([]),
    maintenanceServiceReport: table([]),
    payment: table([]),
    journalEntry: table([]),
    deliverySiteClockJob: table([]),
    jobPhoto: table([]),
    documentEmbedding: table([]),
    priceHistory: table([]),
    storedFile: table([]),
    documentTemplate: table([]),
    userOrganization: table([{ userId: 'u1', organizationId: BC, isActive: true }, { userId: 'u1', organizationId: WCT, isActive: true }]),
    userRole: table([{ userId: 'u1', organizationId: BC, isActive: true }, { userId: 'u1', organizationId: WCT, isActive: true }]),
    $queryRawUnsafe: async (sql: string, ...args: any[]) => {
      if (sql.includes('coalesce("parentOrgId"')) return [{ id: WCT }, { id: BC }];
      if (sql.includes(`config->>'orderId'`)) return db.document.rows.filter((d: Row) => d.organizationId === args[0] && d.config?.orderId === args[1]).map((d: Row) => ({ id: d.id }));
      return [];
    },
    $executeRawUnsafe: async () => 0,
    $transaction: async (fn: any) => fn(db),
  };
  const doc = (id: string, type: string, name: string, status: string, config: any) => db.document.rows.push({ id, type, name, status, organizationId: WCT, documentTemplateId: `tpl-${WCT}-${type}`, projectId: null, config });
  db.order.rows.push({ id: 'o1', organizationId: WCT, orderNumber: 'ORDW202611-001', customerId: 'cw', sourceQuotationId: 'q1', invoiceDocumentId: 'i1', attachments: [{ kind: 'report', reportId: 'r1' }], linkedDocuments: { quotation: [{ id: 'q1', name: 'QO202611-0001' }], do: [{ id: 'd1', name: 'DO202611001' }], invoice: [{ id: 'i1', name: 'INV202611-0001' }] } });
  const inv = { orderId: 'o1', orderNo: 'ORDW202611-001', customerId: 'cw', customer: { id: 'cw', name: 'TEST Client' }, gstPercent: 9, taxApplicable: 'Y', absorbTax: 'N', items: [{ description: 'Hood', amount: 1000 }], subTotal: 1000, gstAmount: 90, nettTotal: 1090, outstandingBalance: 1090, deliveryOrderNos: ['DO202611001'], documentNumber: 'INV202611-0001' };
  doc('q1', 'QUOTATION', 'QO202611-0001', 'confirmed', { customerId: 'cw', orderId: 'o1', items: inv.items });
  doc('d1', 'DELIVERY_ORDER', 'DO202611001', 'confirmed', { customerId: 'cw', orderId: 'o1', orderNo: 'ORDW202611-001', sourceDocumentNumber: 'QO202611-0001' });
  doc('i1', 'INVOICE', 'INV202611-0001', opts.confirmed ? 'pending_payment' : 'draft', inv);
  db.delivery.rows.push({ id: 'j1', organizationId: WCT, deliveryNumber: 7, orderId: 'o1', orderInvoiceId: 'i1', customerId: 'cw', projectId: null });
  db.delivery.rows.push({ id: 'jb', organizationId: BC, deliveryNumber: 41, orderId: null });
  db.maintenanceServiceReport.rows.push({ id: 'r1', organizationId: WCT, reportNumber: 12, documentId: 'd1', invoiceDocumentId: null, deliveryId: 'j1', serviceData: { orderId: 'o1', doNumber: 'DO202611001' } });
  if (opts.confirmed) db.journalEntry.rows.push({ id: 'je1', organizationId: WCT, sourceDocumentId: 'i1', status: 'POSTED', type: 'INVOICE' });
  if (opts.payment) db.payment.rows.push({ id: 'p1', organizationId: WCT, documentId: 'i1', amount: 100 });

  const documents: any = {
    resolveTemplateIdForType: async (type: string, org: string) => `tpl-${org}-${type}`,
    createBasicDocument: async (templateId: string, type: string, org: string, config: any) =>
      db.document.create({ data: { type, name: 'CN202611-0001', organizationId: org, documentTemplateId: templateId, status: 'draft', config } }),
    repostGlForDocument: async (org: string, id: string, type: string) => db.journalEntry.create({ data: { organizationId: org, sourceDocumentId: id, status: 'POSTED', type } }),
    logMoveHistory: jest.fn(async () => undefined),
  };
  const receipts: any = {
    createOffset: jest.fn(async (org: string, dto: any) => {
      for (const a of [...dto.debits, ...dto.credits]) {
        await db.payment.create({ data: { organizationId: org, documentId: a.documentId, amount: a.amount, paymentMethod: 'offset' } });
        const d = db.document.rows.find((r: Row) => r.id === a.documentId);
        d.config = { ...d.config, outstandingBalance: 0, paidToDate: a.amount };
        if (d.type === 'INVOICE') d.status = 'paid';
      }
    }),
  };
  const actionLog: any = { log: jest.fn() };
  const svc = new GstSwitchService(db, documents, receipts, actionLog);
  return { db, svc, receipts, actionLog, documents };
}
const actor = { id: 'u1', name: 'Tester' };
const ar = (db: any, org: string) =>
  Math.round(
    db.document.rows
      .filter((d: Row) => d.organizationId === org && d.type === 'INVOICE' && !['draft', 'unconfirmed'].includes(d.status) && !d.config?.voided)
      .reduce((s: number, d: Row) => s + (Number(d.config?.outstandingBalance) || 0), 0) * 100,
  ) / 100;

describe('gst switch: the move', () => {
  beforeAll(() => {
    process.env.TENANCY_MODE = 'single';
    jest.spyOn(DocumentNumberingService.prototype, 'issueNumberLocked').mockResolvedValue(null as any);
  });
  const ym = () => {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  it('drafts only: WCT (S) > BC Air (non-GST), new numbers, links intact, then back to WCT (S) (GST)', async () => {
    const { db, svc, actionLog } = world();
    const pre: any = await svc.preview('i1', WCT, false);
    expect(pre.blocked).toBeNull();
    expect(pre.headline).toBe('This moves ORDW202611-001 and its 5 documents to BC AIR PTE. LTD.');
    expect(pre.creditNotes).toEqual([]);

    const out: any = await svc.move('i1', WCT, false, actor);
    expect(out.moved).toBe(true);
    const order = db.order.rows[0];
    expect([order.organizationId, order.orderNumber]).toEqual([BC, 'ORDB202611-101']);
    const byId = (id: string) => db.document.rows.find((d: Row) => d.id === id);
    for (const id of ['q1', 'd1', 'i1']) expect(byId(id).organizationId).toBe(BC);
    expect(byId('q1').name).toBe(`QUOTATION${ym()}-001`);
    expect(byId('d1').name).toBe(`DELIVERY_ORDER${ym()}-001`);
    expect(byId('i1').name).toBe(`INVOICE${ym()}-001`);
    expect(byId('i1').documentTemplateId).toBe(`tpl-${BC}-INVOICE`);
    // Non-GST now, "Previously <no.>" kept, the customer is BC Air's (created: none matched).
    const ic = byId('i1').config;
    expect([ic.taxApplicable, ic.gstAmount, ic.nettTotal, ic.previousNumber]).toEqual(['N', 0, 1000, 'INV202611-0001']);
    // The moved quotation is re-taxed too (BC Air = no GST), keeps "Previously", gets no money stamps.
    const qc = byId('q1').config;
    expect([qc.taxApplicable, qc.gstAmount, qc.nettTotal, qc.previousNumber, qc.outstandingBalance]).toEqual(['N', 0, 1000, 'QO202611-0001', undefined]);
    const bcCust = db.customer.rows.find((c: Row) => c.organizationId === BC);
    expect(bcCust).toMatchObject({ name: 'TEST Client', customerCode: 'CT001' });
    expect(db.customer.rows.find((c: Row) => c.id === 'cw').organizationId).toBe(WCT); // never moved
    expect(ic.customerId).toBe(bcCust.id);
    expect(ic.deliveryOrderNos).toEqual([byId('d1').name]);
    expect(ic.orderNo).toBe('ORDB202611-101');
    expect(byId('d1').config.sourceDocumentNumber).toBe(byId('q1').name);
    // Order links follow the new numbers; job + service report move with new numbers and the BC Air brand.
    expect(order.linkedDocuments.do[0].name).toBe(byId('d1').name);
    expect(order.linkedDocuments.invoice[0].name).toBe(byId('i1').name);
    expect(order.customerId).toBe(bcCust.id);
    expect(db.delivery.rows.find((j: Row) => j.id === 'j1')).toMatchObject({ organizationId: BC, deliveryNumber: 42, orderInvoiceId: 'i1', customerId: bcCust.id });
    expect(db.maintenanceServiceReport.rows[0]).toMatchObject({ organizationId: BC, reportNumber: 1, serviceData: { brand: 'BCAIR', doNumber: byId('d1').name, previousReportNumber: 12 } });
    // Activity Log in both companies with old / new numbers.
    const moves = actionLog.log.mock.calls.map((c: any) => c[0]).filter((e: any) => e.action === 'MOVE');
    expect(moves.some((e: any) => e.organizationId === WCT && e.details.oldNumber === 'INV202611-0001' && e.details.newNumber === byId('i1').name)).toBe(true);
    expect(moves.some((e: any) => e.organizationId === BC && e.details.oldNumber === 'ORDW202611-001')).toBe(true);

    // Back: BC Air > GST moves it to WCT (S); the customer maps back to the original (exact name).
    const back: any = await svc.move('i1', BC, true, actor);
    expect(back.moved).toBe(true);
    expect(order.organizationId).toBe(WCT);
    expect(order.orderNumber).toBe('ORDW202611-101');
    expect(byId('i1').config).toMatchObject({ taxApplicable: 'Y', gstAmount: 90, nettTotal: 1090, customerId: 'cw' });
    expect(byId('q1').config).toMatchObject({ taxApplicable: 'Y', gstAmount: 90, nettTotal: 1090, documentInfo: { taxApplicable: 'Y', gstPercent: 9 } });
    expect(byId('i1').config.movedFrom.length).toBe(2);
    expect(db.customer.rows.length).toBe(2);
  });

  it('a confirmed invoice: credit note in WCT (S) (posted, offset), a new draft invoice in BC Air; AR reconciles', async () => {
    const { db, svc, receipts } = world({ confirmed: true });
    expect([ar(db, WCT), ar(db, BC)]).toEqual([1090, 0]);
    const pre: any = await svc.preview('i1', WCT, false);
    expect(pre.creditNotes).toEqual([{ invoiceId: 'i1', invoice: 'INV202611-0001', amount: 1090, already: false }]);
    expect(pre.documents.find((d: any) => d.id === 'i1').action).toBe('credit');

    const out: any = await svc.move('i1', WCT, false, actor);
    const cn = db.document.rows.find((d: Row) => d.type === 'CREDIT_NOTE');
    expect(cn).toMatchObject({ organizationId: WCT, status: 'confirmed', name: 'CN202611-0001' });
    expect(cn.config).toMatchObject({ sourceDocumentId: 'i1', sourceDocumentType: 'INVOICE', nettTotal: 1090 });
    expect(db.journalEntry.rows.some((j: Row) => j.sourceDocumentId === cn.id && j.status === 'POSTED')).toBe(true);
    expect(receipts.createOffset).toHaveBeenCalledWith(WCT, expect.objectContaining({ debits: [{ documentId: 'i1', amount: 1090 }], credits: [{ documentId: cn.id, amount: 1090 }] }), actor);
    // The original stays in WCT (S) with its number and journal; the re-issue is a BC Air draft, non-GST.
    const orig = db.document.rows.find((d: Row) => d.id === 'i1');
    expect([orig.organizationId, orig.name]).toEqual([WCT, 'INV202611-0001']);
    expect(db.journalEntry.rows.find((j: Row) => j.id === 'je1').status).toBe('POSTED');
    const re = db.document.rows.find((d: Row) => d.id === out.invoiceId);
    expect(re).toMatchObject({ organizationId: BC, status: 'draft', type: 'INVOICE' });
    expect(re.config).toMatchObject({ taxApplicable: 'N', nettTotal: 1000, previousNumber: 'INV202611-0001', gstMove: { replaces: { id: 'i1' }, creditNote: { id: cn.id, number: 'CN202611-0001' } }, orderId: 'o1' });
    expect(orig.config.gstMove).toMatchObject({ creditNote: { id: cn.id }, reissued: { id: re.id } });
    expect(cn.config.gstMove.reissued.id).toBe(re.id);
    // Order: the re-issue replaces the credited invoice; the job bills the re-issue; the credit is recorded.
    const order = db.order.rows[0];
    expect(order.linkedDocuments.invoice[0]).toMatchObject({ id: re.id, name: re.name });
    expect(order.linkedDocuments.crossOrgCredit[0]).toMatchObject({ invoiceId: 'i1', creditNoteId: cn.id, reissuedId: re.id });
    expect(order.invoiceDocumentId).toBe(re.id);
    expect(db.delivery.rows.find((j: Row) => j.id === 'j1').orderInvoiceId).toBe(re.id);
    // AR: WCT (S) down by the credited 1,090; BC Air unchanged until the draft is confirmed.
    expect([ar(db, WCT), ar(db, BC)]).toEqual([0, 0]);
    re.status = 'pending_payment';
    expect(ar(db, BC)).toBe(1000);
  });

  it('blocked with a payment: clear message, nothing changed', async () => {
    const { db, svc, receipts } = world({ confirmed: true, payment: true });
    const before = JSON.stringify(db.document.rows) + JSON.stringify(db.order.rows);
    const pre: any = await svc.preview('i1', WCT, false);
    expect(pre.blocked).toBe('INV202611-0001 has a payment or an allocation. Nothing was changed.');
    await expect(svc.move('i1', WCT, false, actor)).rejects.toThrow('has a payment or an allocation');
    expect(JSON.stringify(db.document.rows) + JSON.stringify(db.order.rows)).toBe(before);
    expect(receipts.createOffset).not.toHaveBeenCalled();
  });

  it('no access to the target company: refused before anything changes', async () => {
    const { db, svc } = world();
    db.userRole.rows.splice(0, 1);
    await expect(svc.move('i1', WCT, false, actor)).rejects.toThrow('You do not have access to BC AIR PTE. LTD.');
    expect(db.order.rows[0].organizationId).toBe(WCT);
  });

  it('same company setting: no move (only a draft invoice re-taxed)', async () => {
    const { db, svc } = world();
    const out: any = await svc.move('i1', WCT, true, actor);
    expect(out.moved).toBe(false);
    expect(db.order.rows[0].organizationId).toBe(WCT);
  });
});

// ── Split payment parts (2026-11-25): no "Undo the split first"; every part moves with the order ──
function splitWorld(opts: { confirmedPart?: number; paidPart?: number } = {}) {
  const w = world();
  const { db } = w;
  const i1 = db.document.rows.find((d: Row) => d.id === 'i1');
  const original = JSON.parse(JSON.stringify(i1.config));
  const amounts = [300, 300, 400];
  const ids = ['i1', 'i2', 'i3'];
  const part = (n: number) => {
    const a = amounts[n - 1];
    const gst = Math.round(a * 9) / 100;
    return {
      ...original,
      // Part 3 is not on the order's links nor carries the orderId: it is found through part 1's partIds.
      ...(n === 3 ? { orderId: undefined } : {}),
      documentNumber: `INV202611-0001-${n}`,
      items: [{ description: `Payment ${n}`, quantity: 1, unitPrice: a, amount: a, splitPart: n }],
      subTotal: a,
      gstAmount: gst,
      nettTotal: a + gst,
      outstandingBalance: a + gst,
      invoiceSplit: { groupId: 'i1', part: n, of: 3, baseNumber: 'INV202611-0001', mode: 'rate', ...(n === 1 ? { partIds: ids, restore: { config: original } } : {}) },
    };
  };
  i1.name = 'INV202611-0001-1';
  i1.config = part(1);
  for (const n of [2, 3]) {
    db.document.rows.push({ id: ids[n - 1], type: 'INVOICE', name: `INV202611-0001-${n}`, status: 'draft', organizationId: WCT, documentTemplateId: `tpl-${WCT}-INVOICE`, projectId: null, config: part(n) });
  }
  if (opts.confirmedPart) {
    const d = db.document.rows.find((r: Row) => r.id === ids[opts.confirmedPart! - 1]);
    d.status = 'pending_payment';
    db.journalEntry.rows.push({ id: `je-${d.id}`, organizationId: WCT, sourceDocumentId: d.id, status: 'POSTED', type: 'INVOICE' });
  }
  if (opts.paidPart) db.payment.rows.push({ id: 'pp', organizationId: WCT, documentId: ids[opts.paidPart - 1], amount: 10 });
  return w;
}

describe('gst switch: split payment parts (2026-11-25)', () => {
  beforeAll(() => {
    process.env.TENANCY_MODE = 'single';
    jest.spyOn(DocumentNumberingService.prototype, 'issueNumberLocked').mockResolvedValue(null as any);
  });
  const ym = () => {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const byId = (db: any, id: string) => db.document.rows.find((d: Row) => d.id === id);

  it('all parts drafts: switching any part moves the order with ALL parts, the split kept and re-taxed', async () => {
    const { db, svc } = splitWorld();
    const pre: any = await svc.preview('i3', WCT, false);
    expect(pre.blocked).toBeNull();
    expect(pre.documents.filter((d: any) => d.kind.startsWith('Invoice (part')).map((d: any) => [d.kind, d.name])).toEqual([
      ['Invoice (part 1 of 3)', 'INV202611-0001-1'],
      ['Invoice (part 2 of 3)', 'INV202611-0001-2'],
      ['Invoice (part 3 of 3)', 'INV202611-0001-3'],
    ]);
    const out: any = await svc.move('i3', WCT, false, actor);
    expect(out.moved).toBe(true);
    expect(out.invoiceId).toBe('i3');
    const base = `INVOICE${ym()}-001`;
    for (const [id, n, a] of [['i1', 1, 300], ['i2', 2, 300], ['i3', 3, 400]] as const) {
      const d = byId(db, id);
      expect([d.organizationId, d.name, d.status]).toEqual([BC, `${base}-${n}`, 'draft']);
      expect([d.config.taxApplicable, d.config.gstAmount, d.config.nettTotal, d.config.outstandingBalance]).toEqual(['N', 0, a, a]);
      expect(d.config.invoiceSplit).toMatchObject({ groupId: 'i1', part: n, of: 3, baseNumber: base });
      expect(d.config.previousNumber).toBe(`INV202611-0001-${n}`);
    }
    // Part 1 lists every part; its Undo-split snapshot is the moved original (new base number, non-GST).
    const s1 = byId(db, 'i1').config.invoiceSplit;
    expect(s1.partIds).toEqual(['i1', 'i2', 'i3']);
    expect(s1.restore.config).toMatchObject({ documentNumber: base, taxApplicable: 'N', gstAmount: 0, nettTotal: 1000 });
    // Back again keeps the split too.
    const back: any = await svc.move('i2', BC, true, actor);
    expect(back.moved).toBe(true);
    expect(byId(db, 'i2').config).toMatchObject({ taxApplicable: 'Y', gstAmount: 27, nettTotal: 327, invoiceSplit: { part: 2, of: 3 } });
    expect(byId(db, 'i1').organizationId).toBe(WCT);
  });

  it('a confirmed unpaid part: credit note in the source + a new draft part in the target; the other parts move', async () => {
    const { db, svc } = splitWorld({ confirmedPart: 2 });
    const pre: any = await svc.preview('i1', WCT, false);
    expect(pre.blocked).toBeNull();
    expect(pre.creditNotes).toEqual([{ invoiceId: 'i2', invoice: 'INV202611-0001-2', amount: 327, already: false }]);
    expect(pre.documents.find((d: any) => d.id === 'i2')).toMatchObject({ kind: 'Invoice (part 2 of 3)', action: 'credit' });
    const out: any = await svc.move('i1', WCT, false, actor);
    expect(out.creditNotes).toEqual([{ invoice: 'INV202611-0001-2', creditNote: 'CN202611-0001' }]);
    const base = `INVOICE${ym()}-001`;
    // The confirmed part stays in WCT (S), credited; its re-issue is part 2 in BC Air.
    expect([byId(db, 'i2').organizationId, byId(db, 'i2').name]).toEqual([WCT, 'INV202611-0001-2']);
    const re = byId(db, byId(db, 'i2').config.gstMove.reissued.id);
    expect([re.organizationId, re.name, re.status]).toEqual([BC, `${base}-2`, 'draft']);
    expect(re.config).toMatchObject({ taxApplicable: 'N', nettTotal: 300, invoiceSplit: { groupId: 'i1', part: 2, of: 3, baseNumber: base } });
    expect(byId(db, 'i1').config.invoiceSplit.partIds).toEqual(['i1', re.id, 'i3']);
    expect(byId(db, 'i3')).toMatchObject({ organizationId: BC, name: `${base}-3` });
  });

  it('a paid / allocated part blocks: nothing changes', async () => {
    const { db, svc } = splitWorld({ paidPart: 3 });
    const before = JSON.stringify(db.document.rows);
    const pre: any = await svc.preview('i1', WCT, false);
    expect(pre.blocked).toBe('INV202611-0001-3 has a payment or an allocation. Nothing was changed.');
    await expect(svc.move('i1', WCT, false, actor)).rejects.toThrow('has a payment or an allocation');
    expect(JSON.stringify(db.document.rows)).toBe(before);
  });
});

// ── A3 files + A7 landing (2026-11-25) ──
const OTHER = '0000aaaa-0000-4000-8000-000000000009';
function filesWorld() {
  const w = world();
  const { db } = w;
  const doc = (id: string) => db.document.rows.find((d: Row) => d.id === id);
  const k = {
    signedDo: `org/${WCT}/documents/signed-do/s.pdf`,
    orderFile: `org/${WCT}/orders/report.pdf`,
    msrPhoto: `maintenance-reports/${WCT}/photos/p.jpg`,
    jobPhoto: `org/${WCT}/job-photos/j.jpg`,
    jobThumb: `org/${WCT}/job-photos/j-thumb.jpg`,
    logo: `org/${WCT}/logos/logo.png`,
    stamp: `org/${WCT}/stamps/stamp.png`,
    foreign: `org/${OTHER}/documents/x.pdf`,
    shared: `documents/legacy/shared.pdf`,
  };
  doc('d1').attachments = [{ fileKey: k.signedDo, label: 'Stamped DO' }, { fileKey: k.foreign }];
  doc('q1').config.logoUrl = k.logo;
  doc('i1').config.stampUrl = `https://aims-osiris.s3.ap-southeast-1.amazonaws.com/${k.stamp}`;
  db.order.rows[0].attachments = [...db.order.rows[0].attachments, { kind: 'file', fileKey: k.orderFile }, { kind: 'file', fileKey: k.shared }];
  db.maintenanceServiceReport.rows[0].photos = [k.msrPhoto];
  db.jobPhoto.rows.push({ id: 'jp1', organizationId: WCT, deliveryId: 'j1', fileKey: k.jobPhoto, thumbKey: k.jobThumb });
  db.storedFile.rows.push(
    { key: k.signedDo, organizationId: WCT, quarantined: false, sharedOrgIds: [] },
    { key: k.logo, organizationId: WCT, quarantined: false, sharedOrgIds: [] },
    { key: k.stamp, organizationId: WCT, quarantined: false, sharedOrgIds: [] },
    { key: k.foreign, organizationId: OTHER, quarantined: false, sharedOrgIds: [] },
    { key: k.shared, organizationId: WCT, quarantined: true, sharedOrgIds: [OTHER] },
  );
  // u2: BC Air only; u3: WCT (S) only.
  db.userOrganization.rows.push({ userId: 'u2', organizationId: BC, isActive: true }, { userId: 'u3', organizationId: WCT, isActive: true });
  db.userRole.rows.push({ userId: 'u2', organizationId: BC, isActive: true }, { userId: 'u3', organizationId: WCT, isActive: true });
  return { ...w, k };
}

describe('gst switch: files move with the order (A3, 2026-11-25)', () => {
  beforeAll(() => {
    process.env.TENANCY_MODE = 'single';
    jest.spyOn(DocumentNumberingService.prototype, 'issueNumberLocked').mockResolvedValue(null as any);
  });
  const { FilesService } = require('../files/files.service');
  const opens = async (db: any, key: string, actor: any) => (await new FilesService(db, { getSignedUrl: async (x: string) => `signed:${x}` }).sign([key], actor))[key];

  it('signed DOs, attachments, report files, job photos re-register to the target; keys unchanged; back again', async () => {
    const { db, svc, k } = filesWorld();
    const before = { d1: JSON.stringify(db.document.rows.find((d: Row) => d.id === 'd1').attachments) };
    expect(await opens(db, k.signedDo, { userId: 'u2', activeOrgId: BC })).toBeNull();
    const out: any = await svc.move('i1', WCT, false, actor);
    expect(out.files).toEqual({ moved: 5, shared: 1 });
    const reg = (key: string) => db.storedFile.rows.find((r: Row) => r.key === key);
    for (const key of [k.signedDo, k.orderFile, k.msrPhoto, k.jobPhoto, k.jobThumb]) expect(reg(key).organizationId).toBe(BC);
    // Company files never move; another company's file is left alone; a quarantined file is shared with the target.
    expect([reg(k.logo).organizationId, reg(k.stamp).organizationId, reg(k.foreign).organizationId]).toEqual([WCT, WCT, OTHER]);
    expect(reg(k.shared)).toMatchObject({ organizationId: WCT, quarantined: true, sharedOrgIds: [OTHER, BC] });
    // The stored keys on the records are untouched.
    expect(JSON.stringify(db.document.rows.find((d: Row) => d.id === 'd1').attachments)).toBe(before.d1);
    // files.service: a BC Air user now opens them in BC Air; a WCT (S)-only user no longer does; the logo stays WCT's.
    expect(await opens(db, k.signedDo, { userId: 'u2', activeOrgId: BC })).toBe(`signed:${k.signedDo}`);
    expect(await opens(db, k.jobPhoto, { userId: 'u2', activeOrgId: BC })).toBe(`signed:${k.jobPhoto}`);
    expect(await opens(db, k.signedDo, { userId: 'u3', activeOrgId: WCT })).toBeNull();
    expect(await opens(db, k.logo, { userId: 'u3', activeOrgId: WCT })).toBe(`signed:${k.logo}`);
    // Moving back re-registers them to WCT (S).
    const back: any = await svc.move('i1', BC, true, actor);
    expect(back.files.moved).toBe(5);
    for (const key of [k.signedDo, k.orderFile, k.msrPhoto, k.jobPhoto, k.jobThumb]) expect(reg(key).organizationId).toBe(WCT);
    expect(await opens(db, k.signedDo, { userId: 'u3', activeOrgId: WCT })).toBe(`signed:${k.signedDo}`);
    expect(reg(k.shared).sharedOrgIds).toEqual([OTHER, BC]);
  });
});

describe('gst switch: opening a moved document (A7, 2026-11-25)', () => {
  beforeAll(() => {
    process.env.TENANCY_MODE = 'single';
    jest.spyOn(DocumentNumberingService.prototype, 'issueNumberLocked').mockResolvedValue(null as any);
  });
  it('with access to the target: its link there; without: back to the list with "<no.> moved to <company>"; no access change', async () => {
    const { db, svc } = filesWorld();
    expect(await svc.whereMoved('i1', WCT, { userId: 'u3' })).toEqual({ moved: false });
    await svc.move('i1', WCT, false, actor);
    const inv = db.document.rows.find((d: Row) => d.id === 'i1');
    const yes: any = await svc.whereMoved('i1', WCT, { userId: 'u1' });
    expect(yes).toMatchObject({ moved: true, canOpen: true, number: 'INV202611-0001', to: { id: BC }, path: `/portal/documents/INVOICE/tpl-${BC}-INVOICE/i1`, newNumber: inv.name });
    const rolesBefore = JSON.stringify([db.userOrganization.rows, db.userRole.rows]);
    const no: any = await svc.whereMoved('i1', WCT, { userId: 'u3' });
    expect(no).toEqual({ moved: true, number: 'INV202611-0001', to: { id: BC, name: 'BC AIR PTE. LTD.' }, canOpen: false, listPath: '/portal/sales/invoices', message: 'INV202611-0001 moved to BC AIR PTE. LTD.' });
    expect(((await svc.whereMoved('q1', WCT, { userId: 'u3' })) as any).listPath).toBe('/portal/sales/quotations');
    expect(((await svc.whereMoved('d1', WCT, { userId: 'u3' })) as any).listPath).toBe('/portal/sales/delivery-orders');
    expect(JSON.stringify([db.userOrganization.rows, db.userRole.rows])).toBe(rolesBefore);
    // Opened in the company it is in now, or in a company it never left: nothing to say.
    expect(await svc.whereMoved('i1', BC, { userId: 'u2' })).toEqual({ moved: false });
    expect(await svc.whereMoved('i1', OTHER, { userId: 'u2' })).toEqual({ moved: false });
  });
});

describe('gstSwitchFor (the default non-GST invoice of createBasicDocument reads this)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { gstSwitchFor } = require('./gst-switch-state');
  it('an org outside any group (every org but the WCT group): off, one query', async () => {
    const q = jest.fn(async () => []);
    const out = await gstSwitchFor({ $queryRawUnsafe: q }, 'other-org');
    expect(out).toEqual({ on: false, gst: true, partner: null });
    expect(q).toHaveBeenCalledTimes(1);
  });
  it('BC Air: on, non-GST; WCT (S): on, GST', async () => {
    const { db } = world();
    expect(await gstSwitchFor(db, BC)).toMatchObject({ on: true, gst: false });
    expect(await gstSwitchFor(db, WCT)).toMatchObject({ on: true, gst: true });
  });
  it('a database error: off (never fails a create)', async () => {
    expect(await gstSwitchFor({ $queryRawUnsafe: async () => [{ id: 'a' }, { id: 'b' }], organization: { findMany: async () => { throw new Error('x'); } }, organizationUIConfig: { findMany: async () => [] } }, 'a')).toMatchObject({ on: false });
  });
});

describe('new documents in the non-GST company (2026-11-25: quotations too)', () => {
  const bc = { on: true, gst: false, partner: { id: WCT, name: 'WCT' } };
  const wct = { on: true, gst: true, partner: { id: BC, name: 'BC' } };
  const off = { on: false, gst: true, partner: null };
  const blank = { documentInfo: { taxApplicable: 'Y', gstPercent: 9, absorbTax: 'N' }, items: [] };
  it('BC Air: a new quotation starts Non-GST (Tax N, GST 0), like its invoices', () => {
    for (const t of ['QUOTATION', 'QO', 'QO1']) {
      const q = newDocumentTaxDefault(t, bc, blank);
      expect([q.taxApplicable, q.gstAmount, q.documentInfo.taxApplicable, q.documentInfo.gstAmount]).toEqual(['N', 0, 'N', 0]);
      expect(q.outstandingBalance).toBeUndefined(); // a quotation is not owed
    }
    expect(newDocumentTaxDefault('INVOICE', bc, blank).taxApplicable).toBe('N');
  });
  it('WCT (S), orgs outside the switch, other types and imported documents: unchanged', () => {
    expect(newDocumentTaxDefault('QUOTATION', wct, blank)).toBeNull();
    expect(newDocumentTaxDefault('QUOTATION', off, blank)).toBeNull();
    expect(newDocumentTaxDefault('DELIVERY_ORDER', bc, blank)).toBeNull();
    expect(newDocumentTaxDefault('QUOTATION', bc, { ...blank, erpImport: { source: 'erp' } })).toBeNull();
  });
});

describe('GST switch pop-up: moved report rows are named by kind (UAT 2026-11-25)', () => {
  const { reportRowLabel } = require('./gst-switch.service');
  it('a DO sign-off is not called a service report', () => {
    expect(reportRowLabel('SERVICE')).toBe('Service report');
    expect(reportRowLabel('DO_ACK')).toBe('DO sign-off');
    expect(reportRowLabel('DO_INSTALL')).toBe('DO sign-off');
    expect(reportRowLabel('DO_START')).toBe('Job start record');
  });
});

describe('GST switch: split parts are re-taxed together (UAT 2026-11-25)', () => {
  const { splitGroupRetax } = require('./gst-switch.service');
  const part = (n: number, net: number) => ({
    invoiceSplit: { groupId: 'g1', part: n, of: 2, baseNumber: 'INV202611-0040' },
    items: [{ description: `part ${n}`, quantity: 1, unitPrice: net, amount: net }],
    subTotal: net, gstAmount: Math.round(net * 9) / 100, nettTotal: 0,
  });
  it('the parts GST adds up to the unsplit GST (134.24 on 1491.50); the last part takes the cent', () => {
    const out = splitGroupRetax([['a', part(1, 596.6)], ['b', part(2, 894.9)]], { gstPercent: 9, taxApplicable: 'Y' });
    const byId = Object.fromEntries(out.map((x: any) => [x.id, x.config]));
    const gst = ['a', 'b'].map((id) => (byId[id] ?? (id === 'a' ? part(1, 596.6) : part(2, 894.9))).gstAmount);
    expect(Math.round((gst[0] + gst[1]) * 100) / 100).toBe(134.24);
    expect(byId.b.gstAmount).toBe(80.55);
    expect(byId.b.nettTotal).toBe(975.45);
  });
  it('non-GST: every part GST 0', () => {
    const out = splitGroupRetax([['a', { ...part(1, 596.6), gstAmount: 53.69 }], ['b', { ...part(2, 894.9), gstAmount: 80.55 }]], { gstPercent: 9, taxApplicable: 'N' });
    for (const x of out) expect(x.config.gstAmount).toBe(0);
  });
});
