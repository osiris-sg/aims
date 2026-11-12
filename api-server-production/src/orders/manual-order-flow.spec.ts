import { BadRequestException } from '@nestjs/common';
import { MANUAL_ORDER_STATUSES, deriveManualOrderStatus, isManualOrderFlow, withStatusDate } from './manual-order-flow';
import { deriveOrderStatus } from './wct-orders';
import { PublicSignService } from '../public-sign/public-sign.service';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { SiteClockLinkService } from '../siteclock/siteclock-link.service';

/**
 * Manual order flow + quotation e-sign follow-ups (2026-11-12). The point of
 * most cases: every org WITHOUT the WCT-group flags (CIEL, Biofuel, DEMO...)
 * takes exactly today's path.
 */
const job = (status: string, extra: Record<string, any> = {}) => ({ status, isDraft: false, verificationState: null, orderInvoiceId: null, ...extra });
const ui = (features: Record<string, any>) => ({ organizationUIConfig: { findUnique: async () => ({ features }) } });

// Flags as they are on prod today (2026-11-12) for the orgs that must not change.
const CIEL = { enableIdQuotation: true };
const BIOFUEL = { enableMaintenanceDates: true, enableConfirmQuotation: true };
const DEMO = { enableIdQuotation: true };
const WCT_MANUAL = { enableWctOrders: true, enableQuotationToDelivery: true, enableQuotationESign: true, enableManualOrderFlow: true };

describe('manual order status', () => {
  it('walks the steps in order', () => {
    expect(deriveManualOrderStatus([])).toBe('QUOTATION_SIGNED');
    expect(deriveManualOrderStatus([job('scheduled', { isDraft: true })])).toBe('DO_DRAFT');
    expect(deriveManualOrderStatus([job('scheduled')])).toBe('DO_SCHEDULED');
    expect(deriveManualOrderStatus([job('in_progress')])).toBe('DO_SCHEDULED');
    expect(deriveManualOrderStatus([job('completed', { verificationState: 'pending' })])).toBe('AWAITING_VERIFICATION');
    expect(deriveManualOrderStatus([job('completed', { verificationState: 'verified' })])).toBe('DO_COMPLETED');
    const billed = [job('completed', { verificationState: 'verified', orderInvoiceId: 'inv1' })];
    expect(deriveManualOrderStatus(billed, { invoiceStatuses: ['draft'] })).toBe('INVOICE_DRAFT');
    expect(deriveManualOrderStatus(billed, { invoiceStatuses: ['pending_payment'] })).toBe('INVOICED');
    expect(deriveManualOrderStatus(billed, { invoiceStatuses: ['paid'] })).toBe('PAID');
    expect(deriveManualOrderStatus(billed, { invoiceStatuses: ['paid'], serviceReportSent: true })).toBe('SERVICE_REPORT_SENT');
    expect(MANUAL_ORDER_STATUSES).toHaveLength(9);
  });

  it('a draft next to a finished job keeps the order at DO scheduled; cancelled jobs do not count; claims are not invoices', () => {
    expect(deriveManualOrderStatus([job('completed', { verificationState: 'verified' }), job('scheduled', { isDraft: true })])).toBe('DO_SCHEDULED');
    expect(deriveManualOrderStatus([job('cancelled'), job('scheduled', { isDraft: true })])).toBe('DO_DRAFT');
    expect(deriveManualOrderStatus([job('completed', { orderInvoiceId: 'claim:x' })], { invoiceStatuses: ['paid'] })).toBe('DO_COMPLETED');
  });

  it('keeps the first date of each status', () => {
    const t1 = new Date('2026-11-12T01:00:00Z');
    const t2 = new Date('2026-11-13T01:00:00Z');
    const a = withStatusDate(null, 'DO_DRAFT', t1);
    const b = withStatusDate(a, 'DO_DRAFT', t2);
    expect(b).toEqual({ DO_DRAFT: t1.toISOString() });
    expect(withStatusDate(b, 'DO_SCHEDULED', t2)).toEqual({ DO_DRAFT: t1.toISOString(), DO_SCHEDULED: t2.toISOString() });
  });

  it('the WCT (non-manual) status is unchanged', () => {
    expect(deriveOrderStatus([])).toBe('OPEN');
    expect(deriveOrderStatus([job('completed')], { invoiceStatuses: ['paid'] })).toBe('COMPLETED');
  });

  it('needs BOTH enableManualOrderFlow and enableWctOrders', async () => {
    expect(await isManualOrderFlow(ui(WCT_MANUAL), 'o')).toBe(true);
    expect(await isManualOrderFlow(ui({ enableManualOrderFlow: true }), 'o')).toBe(false);
    for (const f of [CIEL, BIOFUEL, DEMO, { enableWctOrders: true }]) expect(await isManualOrderFlow(ui(f), 'o')).toBe(false);
  });
});

describe('jobs: other orgs are untouched', () => {
  const svc = (features: Record<string, any>) => {
    const s: any = Object.create(DeliveriesService.prototype);
    const writes: string[] = [];
    s.prisma = new Proxy(ui(features) as any, {
      get: (t, model: string) =>
        t[model] ??
        new Proxy({}, { get: (_x, op: string) => async () => { writes.push(`${model}.${op}`); return null; } }),
    });
    s.logger = { warn: () => undefined, log: () => undefined };
    return { s: s as DeliveriesService, writes };
  };

  it('prepareManualOrderJob does nothing (not even a read) for CIEL, Biofuel, DEMO or plain WCT orders', async () => {
    for (const f of [CIEL, BIOFUEL, DEMO, { enableWctOrders: true, enableQuotationToDelivery: true }]) {
      const { s, writes } = svc(f);
      expect(await s.prepareManualOrderJob('run1', 'org')).toBeNull();
      expect(writes).toEqual([]);
    }
  });

  it('the office "Complete job" is refused without the manual flow', async () => {
    for (const f of [CIEL, BIOFUEL, DEMO, { enableWctOrders: true, enableWctFinishModes: true }]) {
      const { s, writes } = svc(f);
      await expect(s.officeCompleteJob('run1', 'org', { id: 'u' }, { mode: 'signature', signature: 'data:x', recipientName: 'A' })).rejects.toBeInstanceOf(BadRequestException);
      expect(writes).toEqual([]);
    }
  });
});

describe('SiteClock link: a manual-flow org is never linked; others as before', () => {
  const link = (byOrg: Record<string, Record<string, any>>) => {
    const s: any = Object.create(SiteClockLinkService.prototype);
    s.prisma = {
      siteClockConnection: { findMany: async () => Object.keys(byOrg).map((organizationId) => ({ organizationId })) },
      organizationUIConfig: { findUnique: async ({ where }: any) => ({ features: byOrg[where.organizationId] }) },
    };
    s.logger = { warn: () => undefined };
    return s as SiteClockLinkService;
  };
  it('a manual-flow WCT org is not linked; WCT without it and other orgs are', async () => {
    const s = link({ wct: { enableSiteClockLink: true, enableWctOrders: true }, wctManual: { enableSiteClockLink: true, ...WCT_MANUAL }, other: { enableSiteClockLink: true } });
    expect(await s.isLinked('wct')).toBe(true);
    expect(await s.isLinked('other')).toBe(true);
    expect(await s.isLinked('wctManual')).toBe(false);
  });
});

describe('quotation e-sign follow-ups (PDF refresh + Activity Log row)', () => {
  const sign = async (features: Record<string, any>, idQuote: boolean) => {
    const s: any = Object.create(PublicSignService.prototype);
    const calls: string[] = [];
    const doc = {
      id: 'q1',
      type: 'QUOTATION',
      name: 'QO-1',
      status: 'draft',
      projectId: idQuote ? 'p1' : null,
      organizationId: 'org',
      documentTemplateId: 't1',
      config: idQuote ? { quote: { header: { clientName: 'Client' } } } : { customerName: 'Client', items: [{ description: 'x', quantity: 1, unitPrice: 10 }] },
    };
    s.resolve = async () => ({ link: { id: 'l1', document: doc }, state: 'active' });
    s.assertHasPricedLines = () => undefined;
    s.projectFor = async () => ({ projectId: 'p1' });
    s.prisma = {
      ...ui(features),
      document: { update: () => calls.push('document.update') },
      documentSignLink: { update: () => calls.push('link.update'), updateMany: () => calls.push('link.updateMany') },
      $transaction: async (ops: any[]) => ops,
      delivery: { findFirst: async () => ({ id: 'existing' }) }, // quotation→delivery: already has a run, nothing created
    };
    s.documents = {
      getOrGeneratePdfUrl: async () => void calls.push('pdf.regenerate'),
      prepareManualOrderJob: async () => void calls.push('manual.prepare'),
      generateSequentialDocumentName: async () => null,
    };
    s.staffWhatsApp = { push: async () => undefined };
    s.notifications = { emit: async () => void calls.push('bell') };
    s.actionLog = { log: async (e: any) => void calls.push(`log:${e.action}:${e.organizationId}`) };
    s.logger = { log: () => undefined, warn: () => undefined };
    await s.sign('tok', { signerName: 'Alice', agreed: true, signatureDataUrl: 'data:image/png;base64,AAAA' }, { ip: '1.2.3.4' });
    return calls;
  };

  it('CIEL (ID quotation), Biofuel and DEMO: exactly the calls they make today, no PDF refresh, no new log row', async () => {
    for (const [f, id] of [[CIEL, true], [DEMO, true], [BIOFUEL, false]] as const) {
      expect(await sign(f, id)).toEqual(['document.update', 'link.update', 'link.updateMany', 'bell']);
    }
  });

  it('an e-sign org (WCT group) also refreshes the signed PDF and logs the customer signature on the org', async () => {
    const calls = await sign({ enableQuotationESign: true }, false);
    expect(calls).toEqual(['document.update', 'link.update', 'link.updateMany', 'bell', 'pdf.regenerate', 'log:SIGN:org']);
  });
});
