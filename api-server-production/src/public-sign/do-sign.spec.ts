import { PublicSignService } from './public-sign.service';

// DO "Send for signature" (manual order flow, WCT 2026-11-25): the quotation's sign link + public page, DO version.
const FLOW = { features: { enableWctOrders: true, enableManualOrderFlow: true } };
const SIG = 'data:image/png;base64,iVBORw0KGgo=';
function make(doc: any, opts: { manual?: boolean } = {}) {
  const links: any[] = [];
  const prisma: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => (opts.manual === false ? { features: {} } : FLOW)) },
    document: { findFirst: jest.fn(async () => doc) },
    documentSignLink: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (a: any) => (links.push({ id: 'l1', ...a.data }), { id: 'l1', ...a.data, createdAt: new Date() })),
      findUnique: jest.fn(async () => ({ id: 'l1', token: 't'.repeat(40), signedAt: null, revokedAt: null, expiresAt: null, document: { ...doc, organizationId: 'org', organization: { name: 'WCT' } } })),
      update: jest.fn(async (a: any) => a),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    $transaction: jest.fn(async (x: any) => x),
  };
  const documents: any = { completeOrderDoBySignLink: jest.fn(async () => ({ id: doc.id, completed: true })), getOrGeneratePdfUrl: jest.fn(async () => 'u'), renderDocumentHtml: jest.fn(async () => ({ html: '<p>DO</p>' })) };
  const notifications: any = { emit: jest.fn(async () => undefined) };
  const staffWhatsApp: any = { push: jest.fn(async () => undefined) };
  const actionLog: any = { log: jest.fn() };
  const svc = new PublicSignService(prisma, documents, notifications, {} as any, {} as any, staffWhatsApp, {} as any, {} as any, actionLog);
  return { svc, prisma, documents, notifications, actionLog, links };
}
const dox = (over: any = {}) => ({ id: 'd1', type: 'DELIVERY_ORDER', name: 'DO202611050', status: 'unconfirmed', projectId: null, documentTemplateId: 'tpl', ...over, config: { orderId: 'o1', orderNo: 'ORDW202611-020', customer: { name: 'TEST Client' }, items: [{ description: 'Degrease', quantity: 1 }], ...(over.config || {}) } });

describe('DO sign link (public-sign)', () => {
  it('a DO on an order gets a sign link (no priced lines needed)', async () => {
    const { svc, links } = make(dox());
    const out = await svc.createForDocument('d1', 'org');
    expect(out.path).toMatch(/^\/sign\//);
    expect(links).toHaveLength(1);
  });
  it('refused: completed, cancelled, imported, not on an order, units to pick, or an org without the manual flow', async () => {
    await expect(make(dox({ status: 'delivered_installed' })).svc.createForDocument('d1', 'org')).rejects.toThrow(/already completed/);
    await expect(make(dox({ config: { cancelled: true } })).svc.createForDocument('d1', 'org')).rejects.toThrow(/cancelled/);
    await expect(make(dox({ config: { erpImport: { source: 'erp' } } })).svc.createForDocument('d1', 'org')).rejects.toThrow(/imported/);
    await expect(make(dox({ config: { orderId: null } })).svc.createForDocument('d1', 'org')).rejects.toThrow(/not on an order/);
    await expect(make(dox({ config: { items: [{ assetId: 'a1' }] } })).svc.createForDocument('d1', 'org')).rejects.toThrow(/without a unit/);
    await expect(make(dox(), { manual: false }).svc.createForDocument('d1', 'org')).rejects.toThrow(/Only quotations/);
  });
  it('the public page says it is a delivery order (no total)', async () => {
    const { svc } = make(dox());
    const p: any = await svc.getByToken('t'.repeat(40));
    expect(p.document).toMatchObject({ docType: 'DELIVERY_ORDER', number: 'DO202611050', grandTotal: 0 });
  });
  it('signing completes the DO through the same path as "Customer signs here", spends the link, tells the office', async () => {
    const { svc, prisma, documents, notifications, actionLog } = make(dox());
    const out: any = await svc.sign('t'.repeat(40), { signerName: 'Lim', signatureDataUrl: SIG, agreed: true }, { ip: '1.2.3.4' });
    expect(out.ok).toBe(true);
    expect(documents.completeOrderDoBySignLink).toHaveBeenCalledWith('d1', 'org', { name: 'Lim', image: SIG });
    expect(prisma.documentSignLink.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'l1' }, data: expect.objectContaining({ signerName: 'Lim' }) }));
    expect(notifications.emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'do_signed', linkUrl: '/portal/orders/o1' }));
    expect(actionLog.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'SIGN', resourceId: 'd1', organizationId: 'org' }));
  });
  it('a DO completed meanwhile refuses the signature', async () => {
    const { svc, documents } = make(dox({ status: 'delivered_installed' }));
    await expect(svc.sign('t'.repeat(40), { signerName: 'Lim', signatureDataUrl: SIG, agreed: true }, {})).rejects.toThrow(/already completed/);
    expect(documents.completeOrderDoBySignLink).not.toHaveBeenCalled();
  });
});
