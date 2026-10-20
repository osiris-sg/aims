/**
 * Round M: the Orders progress bar (one continuous bar, the order's FULL process as denominator — shipment steps
 * count as not started before the first shipment — one-line label with short step names), the SHADOW backfill
 * judge, and a second supplier's own key formats (SIAE_PI_ / SIAE_SC_).
 */
import { barLabel, progressBar, shortStepName } from './trade-dashboard';
import { OrdersService } from './orders.service';
import { profileFor, supplierKeyPatterns } from './trade-profile';
import { judgeStoredRows } from '../ingestion-email/email-filter.judge';
import { shipmentKeyIn, filterDecision } from '../ingestion-email/email-filter.rules';
import { validContractNo, validPiNo } from '../ingestion-email/email-match.rules';
import { sanitizeKeys, mergeKeys } from '../ingestion-email/email-triage.rules';

const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42';
let sort = 0;
const st = (code: string, displayNo: string, status: 'DONE' | 'IN_PROGRESS' | 'NOT_STARTED', o: { na?: boolean; ongoing?: boolean; title?: string } = {}) => ({
  code,
  title: o.title ?? code,
  displayNo,
  sortOrder: sort++,
  status,
  isOngoing: !!o.ongoing,
  notApplicable: !!o.na,
});
// ADH's process: order 0, 1, 2, 11, 13 + shipment 3a–10, 12 (14 ongoing).
const ORDER_STEPS = () => [
  st('CHECK_CONTRACT', '0', 'DONE'),
  st('PI_PAYMENT', '1', 'DONE'),
  st('INVOICE_1', '2', 'NOT_STARTED'),
  st('INVOICE_2', '11', 'NOT_STARTED'),
  st('XERO_HANDOFF', '13', 'NOT_STARTED'),
];
const SHIP_TEMPLATES = [
  ['BL_DRAFT_APPROVAL', '3a'],
  ['SHIPPING_DOCS', '3b'],
  ['CUSTOMER_DOCS', '4'],
  ['SEND_DOCS_SCHEDULE', '5'],
  ['CI_PAYMENT', '6'],
  ['CUSTOMS_TAX_ESTIMATE', '7', 'Customs documents & tax estimate'],
  ['TAX_FUNDS', '8'],
  ['AN_INSTRUCTIONS', '9'],
  ['IMPORT_PERMIT', '10'],
  ['LOGISTICS_PAYMENT', '12'],
  ['DELIVERY_CHANGES', '14'],
].map(([code, displayNo, title], i) => ({ code, displayNo, title: title ?? code, sortOrder: 100 + i, isOngoing: code === 'DELIVERY_CHANGES' }));

describe('label + bar', () => {
  it('one line: "Step 7 of 14 · Customs docs & tax"; awaiting shipment: "2 of 14 · Awaiting shipment"; full name for the tooltip', () => {
    expect(barLabel({ code: 'CUSTOMS_TAX_ESTIMATE', displayNo: '7', title: 'Customs documents & tax estimate' }, 7, 14)).toEqual({
      label: 'Step 7 · Customs docs & tax', // round N: no "of 14" (the count is on the bar's line)
      title: '7. Customs documents & tax estimate',
    });
    expect(barLabel({ code: 'AWAITING_SHIPMENT', displayNo: null, title: 'Awaiting shipment' }, 2, 14).label).toBe('Awaiting shipment');
    expect(barLabel({ code: 'INVOICE_1', displayNo: '2', title: 'Issue and send Invoice #1' }, 2, 14).label).toBe('Step 2 · Invoice #1');
    expect(barLabel({ code: 'CI_PAYMENT', displayNo: '6', title: 'Set up CI payment' }, 4, 10).label).toBe('Step 6 · CI payment');
    expect(shortStepName({ code: 'INVOICE_2', title: 'Issue invoice (single)' })).toBe('Invoice');
    expect(shortStepName({ code: 'SOMETHING_NEW', title: 'A new step' })).toBe('A new step');
  });
  it('in progress / overdue flags for the amber marker and the red tint', () => {
    const b = progressBar(
      [
        { ...st('A', '1', 'DONE'), recordId: 'r' },
        { ...st('B', '2', 'IN_PROGRESS'), recordId: 'r' },
      ],
      new Set(['r']),
    );
    expect(b).toMatchObject({ done: 1, total: 2, inProgress: 1, overdue: true });
  });
});

describe("denominator: the order's full process", () => {
  const order = (o: any) => ({
    id: o.id,
    year: 2026,
    orderNo: o.orderNo,
    shipMonth: '2026-10',
    deliveryMonth: null,
    status: 'OPEN',
    customerId: o.customerId,
    supplierId: 'sup',
    customer: null,
    supplier: null,
    contract: null,
    steps: o.steps,
    shipments: o.shipments ?? [],
  });
  const svc = (rows: any[]) => {
    const prisma: any = {
      tradeOrder: { findMany: jest.fn().mockResolvedValue(rows), count: jest.fn().mockResolvedValue(rows.length), groupBy: jest.fn().mockResolvedValue([]) },
      tradeAlert: { findMany: jest.fn().mockResolvedValue([]) },
      tradeStepTemplate: { findMany: jest.fn().mockResolvedValue(SHIP_TEMPLATES) },
    };
    const config: any = {
      profileOf: jest.fn(async (_o: string, customerId: string) => profileFor(customerId === 'kato' ? { kato: { billingMode: 'SINGLE' } } : {}, customerId)),
      supplierProfileOf: jest.fn(async () => ({ supplierId: 'sup', hasPI: true })),
    };
    return { prisma, s: new OrdersService(prisma, config, {} as any) };
  };
  it('#25 (Invoice #1 N/A) with no shipment yet: 2 of 14 (order 4 + shipment 10), not 2/4 — "2 of 14 · Awaiting shipment"', async () => {
    const { s } = svc([
      order({ id: 'o25', orderNo: 25, customerId: 'sus', steps: [...ORDER_STEPS().slice(0, 2), { ...st('INVOICE_1', '2', 'NOT_STARTED'), notApplicable: true }, ...ORDER_STEPS().slice(3)] }),
    ]);
    const o: any = (await s.list(ORG, {} as any)).items[0];
    expect(o.bar).toMatchObject({ done: 2, total: 14 });
    expect(o.bar.label).toBe('Awaiting shipment');
  });
  it('SUS (two invoices) vs Kato (single invoice: Invoice #1 N/A) — each its own full count', async () => {
    const sus = order({ id: 'o23', orderNo: 23, customerId: 'sus', steps: ORDER_STEPS() });
    const kato = order({ id: 'o24', orderNo: 24, customerId: 'kato', steps: ORDER_STEPS().map((x) => (x.code === 'INVOICE_1' ? { ...x, notApplicable: true } : x)) });
    const r: any = await svc([sus, kato]).s.list(ORG, {} as any);
    expect(r.items.map((o: any) => `${o.label} ${o.bar.done}/${o.bar.total}`)).toEqual(['#23 2/15', '#24 2/14']);
    expect(r.items[0].bar.label).toBe('Step 2 · Invoice #1');
  });
  it("an order with a shipment counts that shipment's real steps (no template padding)", async () => {
    const ship = {
      id: 'sh1',
      seqNo: 1,
      blNumber: null,
      vessel: null,
      voyageNo: null,
      eta: null,
      status: 'OPEN',
      netWeightMt: null,
      steps: SHIP_TEMPLATES.filter((t) => !t.isOngoing).map((t) => ({ ...t, status: 'NOT_STARTED', notApplicable: false })),
    };
    const { prisma, s } = svc([order({ id: 'o19', orderNo: 19, customerId: 'sus', steps: ORDER_STEPS(), shipments: [ship] })]);
    const o: any = (await s.list(ORG, {} as any)).items[0];
    expect(o.bar.total).toBe(15);
    expect(prisma.tradeStepTemplate.findMany).not.toHaveBeenCalled();
  });
});

describe('SHADOW backfill judge (same rule as live intake)', () => {
  const row = (id: string, o: Partial<{ from: string; to: string[]; subject: string; inboxState: string; orderId: string; meta: any }>) => ({
    id,
    messageId: `<${id}@x>`,
    fromAddress: o.from ?? 'x@example.com',
    subject: o.subject ?? null,
    inboxState: o.inboxState ?? 'UNMATCHED',
    rawMeta: o.meta ?? { headerTo: o.to ?? [], cc: [] },
    threadKey: null,
    inReplyTo: null,
    orderId: o.orderId ?? null,
  });
  const CFG = { allowDomains: ['vedanta.co.in'], allowAddresses: ['broker@gmail.com'] };
  it("purged rows are skipped; an allowed sender keeps its thread's internal replies; unknown senders would drop", () => {
    const out = judgeStoredRows(
      [
        row('p', { inboxState: 'PURGED', meta: null }),
        row('a', { from: 'Broker <broker@gmail.com>', subject: 'Draft - Sales Contract' }),
        row('b', { from: 'sayaka@asiadealhub.com', to: ['boss@asiadealhub.com'], subject: 'Re: Draft - Sales Contract' }),
        row('c', { from: 'promo@shop.example.com', subject: 'Sale' }),
        row('d', { from: 'ops@vedanta.co.in', subject: 'Docs' }),
      ],
      CFG,
      ['asiadealhub.com'],
      new Map(),
    );
    expect(out.map((j) => (j.skipped ? `${j.id}:skip` : `${j.id}:${j.keep ? 'KEEP' : 'DROP'}`))).toEqual(['p:skip', 'a:KEEP', 'b:KEEP', 'c:DROP', 'd:KEEP']);
    expect(out[2]).toMatchObject({ reason: 'thread kept by allowed gmail.com' });
  });
  it('a reply on a thread matched to an order is kept as "#19"', () => {
    const out = judgeStoredRows(
      [row('a', { from: 'x@unknown.jp', subject: 'Shipping documents', orderId: 'o19' }), row('b', { from: 'y@unknown.jp', subject: 'Re: Shipping documents' })],
      { allowDomains: [], allowAddresses: [] },
      ['asiadealhub.com'],
      new Map([['o19', 19]]),
    );
    expect(out[1]).toMatchObject({ keep: true, reason: 'thread matched to #19' });
  });
});

describe("a second supplier's own keys (SIAE_PI_ / SIAE_SC_)", () => {
  const profiles = { 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': { supplierId: 'x', hasPI: true, piNoPatterns: ['^SIAE_PI_\\d{8}$'], contractNoPatterns: ['^SIAE_SC_\\d{8}$'], pricingMode: 'FIXED' } };
  const k = supplierKeyPatterns(profiles);
  it('profile patterns are collected per kind', () => {
    expect(k).toEqual({ pi: ['^SIAE_PI_\\d{8}$'], contract: ['^SIAE_SC_\\d{8}$'], ci: [] });
    expect(supplierKeyPatterns(null)).toEqual({ pi: [], contract: [], ci: [] });
  });
  it('SIAE_SC_25100906 is a valid contract no. with the SIAE pattern; Vedanta 4540… still is; a B/L never', () => {
    expect(validContractNo('SIAE_SC_25100906')).toBeNull();
    expect(validContractNo('SIAE_SC_25100906', ['^4540\\d{5}$', ...k.contract])).toBe('SIAE_SC_25100906');
    expect(validContractNo('454003598', ['^4540\\d{5}$', ...k.contract])).toBe('454003598');
    expect(validContractNo('22AA198GX06003', ['^4540\\d{5}$', ...k.contract])).toBeNull();
    expect(sanitizeKeys({ ...mergeKeys(null, {}), contractNo: 'SIAE_SC_25100906' }, undefined, ['^4540\\d{5}$', ...k.contract]).contractNo).toBe('SIAE_SC_25100906');
  });
  it("SIAE_PI_26100906 is recognised as the supplier's PI no.; other PI numbers are kept as read", () => {
    expect(validPiNo('SIAE_PI_26100906', k.pi)).toEqual({ value: 'SIAE_PI_26100906', known: true });
    expect(validPiNo('PI-26100906', k.pi)).toEqual({ value: 'PI-26100906', known: false });
  });
  it('the sender filter treats SIAE_PI_ / SIAE_SC_ in a subject or file name as a shipment key', () => {
    expect(shipmentKeyIn('Re: SIAE_PI_26100906 payment', [], [...k.pi, ...k.contract])).toBe('supplier no. SIAE_PI_26100906');
    expect(shipmentKeyIn('', ['SIAE_SC_25100906.pdf'], [...k.pi, ...k.contract])).toBe('supplier no. SIAE_SC_25100906');
    expect(shipmentKeyIn('SIAE_PI_26100906', [])).toBeNull();
    expect(
      filterDecision({ from: 'x@unknown.id', to: [], cc: [], subject: 'SIAE_PI_26100906', attachmentNames: [], threadOrder: null }, { allowDomains: [], allowAddresses: [], keyPatterns: k.pi }, [])
        .keep,
    ).toBe(true);
  });
});
