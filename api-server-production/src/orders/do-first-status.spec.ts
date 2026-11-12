import { deriveManualOrderStatusFromUnits, unitStateOfJobs } from './manual-order-flow';
import { DeliveriesService } from '../deliveries/deliveries.service';

// DO first (manual order flow, 2026-11-13): the order follows its DOs; jobs are optional.
describe('order status from DOs', () => {
  const U = (state: any, invoiceId: string | null = null) => ({ state, invoiceId });
  it('walks the steps', () => {
    expect(deriveManualOrderStatusFromUnits([])).toBe('QUOTATION_SIGNED');
    expect(deriveManualOrderStatusFromUnits([U('draft'), U('draft')])).toBe('DO_DRAFT');
    expect(deriveManualOrderStatusFromUnits([U('scheduled'), U('draft')])).toBe('DO_SCHEDULED');
    expect(deriveManualOrderStatusFromUnits([U('done'), U('draft')])).toBe('DO_SCHEDULED');
    expect(deriveManualOrderStatusFromUnits([U('done'), U('awaiting')])).toBe('AWAITING_VERIFICATION');
    expect(deriveManualOrderStatusFromUnits([U('done'), U('done')])).toBe('DO_COMPLETED');
    expect(deriveManualOrderStatusFromUnits([U('done', 'i1'), U('done', 'i1')], { invoiceStatuses: ['unconfirmed'] })).toBe('INVOICE_DRAFT');
    expect(deriveManualOrderStatusFromUnits([U('done', 'i1')], { invoiceStatuses: ['pending_payment'] })).toBe('INVOICED');
    expect(deriveManualOrderStatusFromUnits([U('done', 'i1')], { invoiceStatuses: ['paid'] })).toBe('PAID');
    expect(deriveManualOrderStatusFromUnits([U('done', 'i1')], { invoiceStatuses: ['pending_payment'], serviceReportSent: true })).toBe('SERVICE_REPORT_SENT');
    // A DO not billed yet keeps the order at DO completed.
    expect(deriveManualOrderStatusFromUnits([U('done', 'i1'), U('done')], { invoiceStatuses: ['pending_payment'] })).toBe('DO_COMPLETED');
  });
  it("a DO's jobs decide its state, read like the job-based status", () => {
    expect(unitStateOfJobs([{ status: 'scheduled', isDraft: true }])).toBe('draft');
    expect(unitStateOfJobs([{ status: 'scheduled', isDraft: false }])).toBe('scheduled');
    expect(unitStateOfJobs([{ status: 'completed', isDraft: false, verificationState: 'pending' }])).toBe('awaiting');
    expect(unitStateOfJobs([{ status: 'completed', isDraft: false, verificationState: 'verified' }])).toBe('done');
  });
});

describe('Complete DO on a DO with no job (officeCompleteDo)', () => {
  const doc = ({ config, ...over }: any = {}) => ({ id: 'd1', name: 'DO202611018', status: 'unconfirmed', ...over, config: { orderId: 'o1', items: [{ description: 'Degreasing', quantity: 1 }], ...config } });
  function make(d: any, jobs: any[] = []) {
    const writes: any[] = [];
    const prisma: any = {
      organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableWctOrders: true, enableManualOrderFlow: true } })) },
      document: { findFirst: jest.fn(async () => d), update: jest.fn(async (a: any) => writes.push(['doc', a])) },
      maintenanceServiceReport: { create: jest.fn(async (a: any) => writes.push(['proof', a])), findFirst: jest.fn(async () => null) },
      deliveryItem: { findMany: jest.fn(async () => jobs.map((j) => ({ deliveryId: j.id }))), updateMany: jest.fn(async (a: any) => (writes.push(['unlink', a]), { count: 1 })) },
      delivery: { findMany: jest.fn(async () => jobs), update: jest.fn(async (a: any) => writes.push(['job', a])) },
      order: { findFirst: jest.fn(async () => null) },
    };
    const documentsService: any = { bulkCompleteDeliveryOrder: jest.fn(async () => ({ success: true })), addAttachments: jest.fn(async () => undefined), bindDoUnits: jest.fn(async () => ({ bound: 1 })) };
    const svc: any = Object.create(DeliveriesService.prototype);
    const officeCompleteJob = jest.fn(async (id: string) => ({ id }));
    Object.assign(svc, { prisma, documentsService, officeCompleteJob, logger: { warn: jest.fn(), log: jest.fn() } });
    return { svc: svc as DeliveriesService, writes, documentsService, officeCompleteJob };
  }
  const SIG = 'data:image/png;base64,iVBORw0KGgo=';

  it('signature: a signed proof on the DO, then the DO is completed (stock + order invoice follow)', async () => {
    const { svc, writes, documentsService } = make(doc());
    const out = await svc.officeCompleteDo('org', 'd1', { mode: 'signature', signature: SIG, recipientName: 'Lim Valerie' }, { id: 'u1', name: 'Office' });
    expect(out).toEqual({ id: 'd1', completed: true });
    const proof = writes.find((w) => w[0] === 'proof')[1].data;
    expect(proof).toMatchObject({ documentId: 'd1', deliveryId: null, kind: 'DO_ACK', status: 'completed', signature: SIG, signedByName: 'Lim Valerie' });
    expect(documentsService.bulkCompleteDeliveryOrder).toHaveBeenCalledWith('d1', 'org');
  });

  it('sign link: the DO waits for the customer, not completed yet', async () => {
    const { svc, writes, documentsService } = make(doc());
    const out = await svc.officeCompleteDo('org', 'd1', { mode: 'sign_link' }, { id: 'u1' });
    expect(out).toEqual({ id: 'd1', completed: false, awaitingSignature: true });
    expect(writes.find((w) => w[0] === 'doc')[1].data.config).toMatchObject({ awaitingSignature: true, completionMode: 'sign_link' });
    expect(documentsService.bulkCompleteDeliveryOrder).not.toHaveBeenCalled();
  });

  it('product lines: the picked units are bound (and reserved) before the DO is completed, no job needed', async () => {
    const units = [{ assetId: 'a1', inventoryId: 'u1' }];
    const { svc, documentsService } = make(doc({ config: { items: [{ assetId: 'a1', description: 'UVC emitter' }] } }));
    const out = await svc.officeCompleteDo('org', 'd1', { mode: 'signature', signature: SIG, recipientName: 'Lim', units }, { id: 'u' });
    expect(out).toEqual({ id: 'd1', completed: true });
    expect(documentsService.bindDoUnits).toHaveBeenCalledWith('d1', 'org', units);
    expect(documentsService.bulkCompleteDeliveryOrder).toHaveBeenCalledWith('d1', 'org');
    // A refused completion (no signature) reserves nothing.
    const bad = make(doc({ config: { items: [{ assetId: 'a1', description: 'UVC emitter' }] } }));
    await expect(bad.svc.officeCompleteDo('org', 'd1', { mode: 'signature', recipientName: 'Lim', units }, {})).rejects.toThrow(/sign in the box/);
    expect(bad.documentsService.bindDoUnits).not.toHaveBeenCalled();
  });

  it('a DO whose job is scheduled: completed through that job (the job path, same body)', async () => {
    const body = { mode: 'signature', signature: SIG, recipientName: 'A' };
    const { svc, officeCompleteJob, documentsService } = make(doc(), [{ id: 'j1', deliveryNumber: 7, isDraft: false, status: 'scheduled' }]);
    const out: any = await svc.officeCompleteDo('org', 'd1', body, { id: 'u' });
    expect(officeCompleteJob).toHaveBeenCalledWith('j1', 'org', { id: 'u' }, body);
    expect(out).toMatchObject({ id: 'd1', completed: true, viaJob: 7 });
    expect(documentsService.bulkCompleteDeliveryOrder).not.toHaveBeenCalled();
  });

  it('a DO whose only job is an unscheduled draft (ORD202611-007): the draft is cancelled and unlinked, the DO completed', async () => {
    const { svc, writes, documentsService, officeCompleteJob } = make(doc(), [{ id: 'j7', deliveryNumber: 7, isDraft: true, status: 'scheduled' }]);
    const out = await svc.officeCompleteDo('org', 'd1', { mode: 'signature', signature: SIG, recipientName: 'A' }, { id: 'u' });
    expect(out).toEqual({ id: 'd1', completed: true });
    expect(officeCompleteJob).not.toHaveBeenCalled();
    expect(writes.find((w) => w[0] === 'unlink')[1]).toMatchObject({ where: { deliveryId: 'j7', documentId: 'd1' }, data: { documentId: null } });
    expect(writes.find((w) => w[0] === 'job')[1].data.status).toBe('cancelled');
    expect(documentsService.bulkCompleteDeliveryOrder).toHaveBeenCalledWith('d1', 'org');
  });

  it('refuses a DO completed or cancelled', async () => {
    await expect(make(doc({ status: 'delivered_installed' })).svc.officeCompleteDo('org', 'd1', { mode: 'sign_link' }, {})).rejects.toThrow(/already completed/);
    await expect(make(doc({ config: { cancelled: true } })).svc.officeCompleteDo('org', 'd1', { mode: 'sign_link' }, {})).rejects.toThrow(/cancelled/);
  });
});
