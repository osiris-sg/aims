import { MaintenanceReportsService } from './maintenance-reports.service';

// Manual order flow (2026-11-13): office service reports name a customer AND a DO.
const CUST = { id: 'c1', name: 'Yoshinoya', email: 'y@x.sg' };
const DO = { id: 'd1', name: 'DO202611018', config: { customerId: 'c1', orderId: 'o1', orderNo: 'ORD202611-005', date: '2026-11-13' } };

function make(opts: { manual?: boolean; doc?: any; job?: string | null; openDraft?: any } = {}) {
  const writes: any[] = [];
  const prisma: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features: opts.manual === false ? { enableWctOrders: true } : { enableWctOrders: true, enableManualOrderFlow: true } })) },
    customer: { findFirst: jest.fn(async () => CUST) },
    document: { findFirst: jest.fn(async () => (opts.doc === undefined ? DO : opts.doc)), findMany: jest.fn(async () => [DO, { ...DO, id: 'd2', config: { ...DO.config, cancelled: true } }]) },
    deliveryItem: {
      findFirst: jest.fn(async () => (opts.job ? { deliveryId: opts.job, delivery: { siteAddress: '60 Paya Lebar Rd' } } : null)),
      findMany: jest.fn(async () => []),
    },
    maintenanceServiceReport: {
      findFirst: jest.fn(async () => opts.openDraft ?? null),
      create: jest.fn(async (a: any) => (writes.push(['create', a]), { id: 'r-new', reportNumber: null, status: 'draft' })),
      update: jest.fn(async (a: any) => (writes.push(['update', a]), { id: a.where.id, reportNumber: null, status: 'draft' })),
    },
    accountingSetting: { findUnique: jest.fn(async () => null) },
  };
  const svc: any = Object.create(MaintenanceReportsService.prototype);
  Object.assign(svc, { prisma });
  return { svc: svc as MaintenanceReportsService, writes };
}

describe('office service report (createOffice)', () => {
  it('creates a numberless draft linked to the customer and the DO (order follows from the DO)', async () => {
    const { svc, writes } = make({ job: 'j1' });
    const r = await svc.createOffice({ customerId: 'c1', doDocumentId: 'd1' }, 'org', 'u1');
    expect(r).toMatchObject({ id: 'r-new', reportNumber: null });
    const data = writes[0][1].data;
    expect(data.status).toBe('draft');
    expect(data.deliveryId).toBe('j1');
    expect(data.serviceData).toMatchObject({ office: true, scheduled: true, customerId: 'c1', doDocumentId: 'd1', doNumber: 'DO202611018', orderId: 'o1', orderNo: 'ORD202611-005', jobLocation: '60 Paya Lebar Rd' });
  });

  it("reuses the DO's job's own open draft instead of making a second report", async () => {
    const { svc, writes } = make({ job: 'j1', openDraft: { id: 'r-open', serviceData: { scheduled: true, customerName: 'Yoshinoya' } } });
    await svc.createOffice({ customerId: 'c1', doDocumentId: 'd1' }, 'org', 'u1');
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe('update');
    expect(writes[0][1].where.id).toBe('r-open');
    expect(writes[0][1].data.serviceData).toMatchObject({ office: true, doDocumentId: 'd1' });
  });

  it('needs both the customer and the DO, the manual flow, and a DO of that customer', async () => {
    await expect(make().svc.createOffice({ customerId: 'c1' }, 'org', 'u1')).rejects.toThrow(/customer and the DO/);
    await expect(make({ manual: false }).svc.createOffice({ customerId: 'c1', doDocumentId: 'd1' }, 'org', 'u1')).rejects.toThrow(/manual order flow/);
    await expect(make({ doc: { ...DO, config: { customerId: 'other' } } }).svc.createOffice({ customerId: 'c1', doDocumentId: 'd1' }, 'org', 'u1')).rejects.toThrow(/another customer/);
    await expect(make({ doc: { ...DO, config: { ...DO.config, cancelled: true } } }).svc.createOffice({ customerId: 'c1', doDocumentId: 'd1' }, 'org', 'u1')).rejects.toThrow(/cancelled/);
  });
});

describe('DO options for the pickers', () => {
  it("lists the customer's DOs, cancelled ones left out", async () => {
    const { svc } = make();
    const list = await svc.doOptions('org', 'c1');
    expect(list.map((d: any) => d.id)).toEqual(['d1']);
    expect(list[0]).toMatchObject({ name: 'DO202611018', date: '2026-11-13', orderNo: 'ORD202611-005' });
  });
});

describe('upload in the manual flow', () => {
  it('refuses an upload without the customer and the DO', async () => {
    const { svc } = make();
    await expect(svc.createUploaded({ fileKey: 'maintenance-reports/org/uploads/x.pdf', fileName: 'x.pdf', mimeType: 'application/pdf', customerId: 'c1' }, 'org', 'u1')).rejects.toThrow(/customer and the DO/);
  });
});

describe('completing an office report (no job)', () => {
  it('gets the next number, keeps the on-screen signature, and is not emailed yet', async () => {
    const report = { id: 'r1', status: 'draft', deliveryId: null, reportNumber: null, serviceData: { scheduled: true, office: true, doDocumentId: 'd1', customerName: 'Yoshinoya' } };
    const update = jest.fn(async (a: any) => ({ id: 'r1', ...a.data }));
    const prisma: any = {
      maintenanceServiceReport: { findFirst: jest.fn().mockResolvedValueOnce(report).mockResolvedValueOnce({ reportNumber: 41 }), update },
      delivery: { findFirst: jest.fn() },
      document: { findFirst: jest.fn(async () => null) },
    };
    const svc: any = Object.create(MaintenanceReportsService.prototype);
    const email = jest.fn(async () => undefined);
    Object.assign(svc, { prisma, sendReportEmailInBackground: email });
    const out = await svc.completeScheduled('r1', { serviceData: { clientSignatureKey: 'maintenance-reports/sig.png', signedByName: 'Lim Valerie', remarks: 'ok' } }, 'org', 'u1');
    expect(out.reportNumber).toBe(42);
    expect(out.status).toBe('completed');
    expect(out.signature).toBe('maintenance-reports/sig.png');
    expect(out.signedByName).toBe('Lim Valerie');
    expect(out.serviceData).toMatchObject({ office: true, doDocumentId: 'd1', clientSignatureKey: 'maintenance-reports/sig.png' });
    expect(out.serviceData.scheduled).toBeUndefined();
    expect(prisma.delivery.findFirst).not.toHaveBeenCalled();
    expect(email).not.toHaveBeenCalled();
  });
});
