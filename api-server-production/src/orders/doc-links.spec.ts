import { NotFoundException } from '@nestjs/common';
import { DocLinksService } from './doc-links.service';
import { directLinksOf, docHref, pageKindOf, parsePickKind, pickerKindsFor, sameCustomerFirst, withDirectLink, withoutDirectLink } from './doc-links';

const ORG = 'org-wct';
const CUST = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const QO = id(1);
const DO = id(2);
const INV = id(3);
const ORDER = id(9);

function world(over: { docs?: any[]; orders?: any[]; wct?: boolean } = {}) {
  const docs = new Map<string, any>(
    (
      over.docs ?? [
        { id: QO, name: 'QO202611-0050', type: 'QUOTATION', status: 'draft', documentTemplateId: 'tq', config: { customerId: CUST } },
        { id: DO, name: 'DO202611-0007', type: 'DELIVERY_ORDER', status: 'draft', documentTemplateId: 'td', config: { customerId: CUST, orderId: ORDER } },
        { id: INV, name: 'INV202611-0030', type: 'INVOICE', status: 'draft', documentTemplateId: 'ti', config: { customerId: CUST } },
      ]
    ).map((d) => [d.id, { ...d }]),
  );
  const orders = new Map<string, any>((over.orders ?? [{ id: ORDER, orderNumber: 'ORDW202611-001', status: 'OPEN', customerId: CUST, sourceQuotationId: null, linkedDocuments: {}, sourceQuotation: null }]).map((o) => [o.id, { ...o }]));
  const prisma: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableWctOrders: over.wct !== false } })) },
    document: {
      findFirst: jest.fn(async ({ where }: any) => {
        const d = docs.get(where.id);
        if (!d) return null;
        if (where.type?.in && !where.type.in.includes(d.type)) return null;
        return { ...d };
      }),
      findMany: jest.fn(async ({ where }: any) => [...docs.values()].filter((d) => where.id?.in?.includes(d.id))),
      update: jest.fn(async ({ where, data }: any) => docs.set(where.id, { ...docs.get(where.id), ...data })),
    },
    order: {
      findFirst: jest.fn(async ({ where }: any) => (orders.get(where.id) ? { ...orders.get(where.id) } : null)),
      // orderHoldersOf: an order holds a document through config.orderId (pointed ids) or its link lists.
      findMany: jest.fn(async ({ where }: any) => {
        const pointed = new Set<string>((where.OR ?? []).flatMap((c: any) => c.id?.in ?? []));
        const listed = (where.OR ?? []).filter((c: any) => c.linkedDocuments).map((c: any) => c.linkedDocuments.array_contains?.[0]?.id);
        return [...orders.values()].filter((o) => pointed.has(o.id) || listed.some((x: string) => JSON.stringify(o.linkedDocuments ?? {}).includes(x)));
      }),
    },
    deliveryItem: { findMany: jest.fn(async () => []) },
    delivery: { findMany: jest.fn(async () => []) },
    customer: { findFirst: jest.fn(async () => null) },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    $queryRawUnsafe: jest.fn(async () => []),
  };
  const orders$ = {
    linkImportedDocument: jest.fn(async (orderId: string, _org: string, body: any) => {
      const o = orders.get(orderId);
      const key = body.type === 'QUOTATION' ? 'quotation' : body.type === 'INVOICE' ? 'invoice' : 'do';
      o.linkedDocuments = { ...(o.linkedDocuments || {}), [key]: [...(o.linkedDocuments?.[key] ?? []), { id: body.id }] };
      return { orderNumber: o.orderNumber };
    }),
    unlinkImportedDocument: jest.fn(async () => ({})),
  };
  const refs = { link: jest.fn(async () => ({ orderId: ORDER, orderNumber: 'ORDW202611-001', createdOrder: false })), unlink: jest.fn(async () => ({ orderNumber: 'ORDW202611-001' })) };
  const svc = new DocLinksService(prisma, orders$ as any, refs as any);
  return { svc, prisma, docs, orders, orders$, refs };
}

describe('Link Document rules (pure)', () => {
  it('tabs: Order, QO, DO, Invoice minus the page type', () => {
    expect(pickerKindsFor('QUOTATION')).toEqual(['ORDER', 'DELIVERY_ORDER', 'INVOICE']);
    expect(pickerKindsFor('DELIVERY_ORDER')).toEqual(['ORDER', 'QUOTATION', 'INVOICE']);
    expect(pickerKindsFor('INVOICE')).toEqual(['ORDER', 'QUOTATION', 'DELIVERY_ORDER']);
    expect(parsePickKind('do')).toBe('DELIVERY_ORDER');
    expect(parsePickKind('qo')).toBe('QUOTATION');
    expect(parsePickKind('bill')).toBeNull();
    expect(pageKindOf('QO2')).toBe('QUOTATION');
    expect(pageKindOf('BILL')).toBeNull();
  });

  it('direct links: added once, removed, read back; hrefs; same customer first', () => {
    const l = { id: DO, type: 'DELIVERY_ORDER', name: 'DO-1', templateId: 't' };
    const c = withDirectLink(withDirectLink({ a: 1 }, l), l);
    expect(directLinksOf(c)).toHaveLength(1);
    expect(c.a).toBe(1);
    expect(directLinksOf(withoutDirectLink(c, DO))).toEqual([]);
    expect(directLinksOf({ linkedDocs: 'x' })).toEqual([]);
    expect(docHref('DO', 'tpl', 'x')).toBe('/portal/documents/DELIVERY_ORDER/tpl/x');
    expect(docHref('INVOICE', null, 'x')).toBeNull();
    expect(sameCustomerFirst([{ customerId: 'b' }, { customerId: 'a' }, { customerId: 'b' }, { customerId: 'a' }], 'a').map((r) => r.customerId)).toEqual(['a', 'a', 'b', 'b']);
  });
});

describe('Link Document service', () => {
  it('flag off (every org outside the WCT orders flag): 404, nothing read or written', async () => {
    const w = world({ wct: false });
    await expect(w.svc.picker(ORG, { documentId: QO, kind: 'DO' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(w.svc.link(ORG, { documentId: QO, kind: 'DO', id: DO }, {})).rejects.toBeInstanceOf(NotFoundException);
    expect(w.prisma.document.update).not.toHaveBeenCalled();
  });

  it('a quotation picks a DO that is on an order: the quotation goes on that same order (order page link)', async () => {
    const w = world();
    const out: any = await w.svc.link(ORG, { documentId: QO, kind: 'DELIVERY_ORDER', id: DO }, { id: 'u1' });
    expect(out).toMatchObject({ mode: 'order', orderNumber: 'ORDW202611-001', targetName: 'DO202611-0007' });
    expect(w.orders$.linkImportedDocument).toHaveBeenCalledWith(ORDER, ORG, { type: 'QUOTATION', id: QO }, { id: 'u1' });
    // Read back: the pill names the order, and it can be taken off again (a linked quotation, not its own).
    const links: any = await w.svc.links(ORG, QO);
    expect(links.order).toMatchObject({ orderNumber: 'ORDW202611-001', unlinkable: true });
    await w.svc.unlink(ORG, { documentId: QO, kind: 'ORDER' }, { id: 'u1' });
    expect(w.orders$.unlinkImportedDocument).toHaveBeenCalledWith(ORDER, ORG, { type: 'QUOTATION', id: QO }, { id: 'u1' });
  });

  it('picking an Order links the document to it; an invoice picking a quotation keeps today\'s rule', async () => {
    const w = world();
    await w.svc.link(ORG, { documentId: INV, kind: 'ORDER', id: ORDER }, {});
    expect(w.orders$.linkImportedDocument).toHaveBeenCalledWith(ORDER, ORG, { type: 'INVOICE', id: INV }, {});
    const w2 = world();
    await w2.svc.link(ORG, { documentId: INV, kind: 'QUOTATION', id: QO }, {});
    expect(w2.refs.link).toHaveBeenCalledWith(ORG, { documentId: INV, quotationId: QO }, {});
    expect(w2.orders$.linkImportedDocument).not.toHaveBeenCalled();
  });

  it('no order on either side: the two documents are linked to each other, and unlinked from both', async () => {
    const w = world();
    w.docs.get(DO).config = { customerId: CUST };
    const out: any = await w.svc.link(ORG, { documentId: INV, kind: 'DELIVERY_ORDER', id: DO }, {});
    expect(out).toMatchObject({ mode: 'direct', targetName: 'DO202611-0007' });
    expect(directLinksOf(w.docs.get(INV).config).map((l) => l.id)).toEqual([DO]);
    expect(directLinksOf(w.docs.get(DO).config).map((l) => l.id)).toEqual([INV]);
    expect(w.orders$.linkImportedDocument).not.toHaveBeenCalled();
    await w.svc.unlink(ORG, { documentId: INV, kind: 'DIRECT', id: DO }, {});
    expect(directLinksOf(w.docs.get(INV).config)).toEqual([]);
    expect(directLinksOf(w.docs.get(DO).config)).toEqual([]);
  });

  it('refused: another customer, the page\'s own type, a document already on another order', async () => {
    const w = world();
    w.docs.get(DO).config = { customerId: OTHER };
    await expect(w.svc.link(ORG, { documentId: INV, kind: 'DELIVERY_ORDER', id: DO }, {})).rejects.toThrow('is for another customer');
    await expect(w.svc.link(ORG, { documentId: QO, kind: 'QUOTATION', id: QO }, {})).rejects.toThrow('Pick a document to link');
    const w3 = world({
      orders: [
        { id: ORDER, orderNumber: 'ORDW202611-001', status: 'OPEN', customerId: CUST, linkedDocuments: {} },
        { id: id(8), orderNumber: 'ORDW202611-002', status: 'OPEN', customerId: CUST, linkedDocuments: { invoice: [{ id: INV }] } },
      ],
    });
    await expect(w3.svc.link(ORG, { documentId: INV, kind: 'ORDER', id: ORDER }, {})).rejects.toThrow('ORDW202611-002');
    expect(w3.orders$.linkImportedDocument).not.toHaveBeenCalled();
  });
});
