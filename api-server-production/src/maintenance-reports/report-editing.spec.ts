import { MaintenanceReportsService, withHistory } from './maintenance-reports.service';

// Editing service reports (manual order flow, 2026-11-13).
function make(row: any, extra: any = {}) {
  const writes: any[] = [];
  const prisma: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableWctOrders: true, enableManualOrderFlow: true } })) },
    maintenanceServiceReport: {
      findFirst: jest.fn(async () => row),
      update: jest.fn(async (a: any) => (writes.push(a), { id: row.id, ...a.data })),
    },
    customer: { findFirst: jest.fn(async () => ({ id: 'c2', name: 'New Co' })) },
    document: { findFirst: jest.fn(async () => ({ id: 'd2', name: 'DO202611050', config: { customerId: 'c2', orderId: 'o2', orderNo: 'ORD202611-020' } })) },
    deliveryItem: { findFirst: jest.fn(async () => null) },
    order: { findFirst: jest.fn(async () => ({ attachments: [{ id: 'att1', kind: 'report', reportId: row.id }] })) },
    ...extra,
  };
  const ordersService: any = { addOrderAttachment: jest.fn(async () => undefined), removeOrderAttachment: jest.fn(async () => undefined) };
  const svc: any = Object.create(MaintenanceReportsService.prototype);
  Object.assign(svc, { prisma, ordersService });
  return { svc: svc as MaintenanceReportsService, writes, ordersService };
}
const FILE = { fileKey: 'maintenance-reports/org/uploads/new.pdf', fileName: 'new.pdf', mimeType: 'application/pdf' };
const ME = { id: 'u1', name: 'Office' };

describe('editing service reports', () => {
  it('replace file: new file in place, the old one in the history, number untouched', async () => {
    const row = { id: 'r1', status: 'completed', reportNumber: 7, serviceData: { uploaded: true, uploadedFile: { key: 'k-old', fileName: 'old.pdf' } } };
    const { svc, writes } = make(row);
    await svc.replaceUploadedFile('r1', FILE, 'org', ME);
    const sd = writes[0].data.serviceData;
    expect(sd.uploadedFile.fileName).toBe('new.pdf');
    expect(sd.history.at(-1)).toMatchObject({ action: 'Replaced the file', by: 'Office', oldFile: { fileName: 'old.pdf' }, changes: [{ field: 'file', from: 'old.pdf', to: 'new.pdf' }] });
    expect(writes[0].data.reportNumber).toBeUndefined();
  });

  it('edit details: customer + DO required; the order link follows the DO; history old -> new', async () => {
    const row = { id: 'r1', status: 'completed', reportNumber: 7, serviceData: { uploaded: true, customerName: 'Old Co', doNumber: 'DO1', orderId: 'o1', orderNo: 'ORD1', serviceDate: '2026-11-01', jobLocation: 'A' } };
    const { svc, writes, ordersService } = make(row);
    await expect(svc.updateUploadedDetails('r1', { customerId: 'c2' }, 'org', ME)).rejects.toThrow(/customer and the DO/);
    await svc.updateUploadedDetails('r1', { customerId: 'c2', doDocumentId: 'd2', serviceDate: '2026-11-02', location: 'B' }, 'org', ME);
    const sd = writes[0].data.serviceData;
    expect(sd).toMatchObject({ customerName: 'New Co', doNumber: 'DO202611050', orderId: 'o2', serviceDate: '2026-11-02', jobLocation: 'B' });
    expect(sd.history.at(-1).changes).toEqual(expect.arrayContaining([{ field: 'customerName', from: 'Old Co', to: 'New Co' }, { field: 'doNumber', from: 'DO1', to: 'DO202611050' }]));
    expect(ordersService.removeOrderAttachment).toHaveBeenCalledWith('o1', 'org', 'att1');
    expect(ordersService.addOrderAttachment).toHaveBeenCalledWith('o2', 'org', { kind: 'report', reportId: 'r1' }, ME);
  });

  it('edit a signed form report: back to draft, signature cleared, signed copy kept, number kept, no auto email later', async () => {
    const row = { id: 'r1', status: 'completed', reportNumber: 7, signature: 'sig-key', signedByName: 'Lim', signedAt: new Date('2026-11-10'), serviceData: { office: true, clientSignatureKey: 'sig-key', signedByName: 'Lim', wct: { jobTypes: ['A'] } } };
    const { svc, writes } = make(row);
    const out = await svc.reopenForEditing('r1', 'org', ME);
    expect(out).toEqual({ id: 'r1', reopened: true, wasSigned: true });
    const d = writes[0].data;
    expect(d).toMatchObject({ status: 'draft', signature: null, signedByName: null, signedAt: null });
    expect(d.serviceData.clientSignatureKey).toBeUndefined();
    expect(d.serviceData).toMatchObject({ scheduled: true, office: true });
    expect(d.serviceData.history.at(-1).signedCopy).toMatchObject({ clientSignatureKey: 'sig-key', signedByName: 'Lim', wct: { jobTypes: ['A'] } });
    expect(d.reportNumber).toBeUndefined();
  });

  it('delete: only before it is sent; soft, so the number stays a gap', async () => {
    const sent = make({ id: 'r1', status: 'completed', reportNumber: 7, serviceData: { customerSentAt: '2026-11-11T00:00:00Z' } });
    await expect(sent.svc.deleteUnsent('r1', 'org', ME)).rejects.toThrow(/sent to the customer/);
    expect(sent.writes).toHaveLength(0);
    const { svc, writes } = make({ id: 'r1', status: 'completed', reportNumber: 7, deliveryId: 'j1', serviceData: { orderId: 'o1' } });
    const out = await svc.deleteUnsent('r1', 'org', ME);
    expect(out).toEqual({ id: 'r1', deleted: true, reportNumber: 7 });
    expect(writes[0].data).toMatchObject({ deliveryId: null, invoiceDocumentId: null });
    expect(writes[0].data.serviceData).toMatchObject({ deletedBy: 'u1', deletedFromDeliveryId: 'j1' });
    expect(writes[0].data.reportNumber).toBeUndefined();
  });

  it('a deleted report cannot be edited again', async () => {
    const { svc } = make({ id: 'r1', status: 'completed', reportNumber: 7, serviceData: { uploaded: true, uploadedFile: { fileName: 'x' }, deletedAt: '2026-11-13' } });
    await expect(svc.replaceUploadedFile('r1', FILE, 'org', ME)).rejects.toThrow(/deleted/);
  });

  it('history keeps the newest 60 lines', () => {
    const h = Array.from({ length: 70 }, (_, i) => ({ n: i }));
    const out = withHistory(h, { action: 'x' });
    expect(out).toHaveLength(60);
    expect(out.at(-1)).toMatchObject({ action: 'x' });
  });
});

describe('completing a reopened report keeps its number', () => {
  it('uses the existing number and records what changed', async () => {
    const report = { id: 'r1', status: 'draft', deliveryId: null, reportNumber: 7, serviceData: { scheduled: true, office: true, doDocumentId: 'd1', remarks: 'old' } };
    const update = jest.fn(async (a: any) => ({ id: 'r1', ...a.data }));
    const prisma: any = {
      maintenanceServiceReport: { findFirst: jest.fn().mockResolvedValueOnce(report).mockResolvedValueOnce({ reportNumber: 41 }), update },
      document: { findFirst: jest.fn(async () => null) },
    };
    const svc: any = Object.create(MaintenanceReportsService.prototype);
    Object.assign(svc, { prisma, sendReportEmailInBackground: jest.fn() });
    const out = await svc.completeScheduled('r1', { serviceData: { remarks: 'new' } }, 'org', 'u1');
    expect(out.reportNumber).toBe(7);
    expect(out.serviceData.history.at(-1)).toMatchObject({ action: 'Completed again after editing', changes: [{ field: 'remarks', from: 'old', to: 'new' }] });
  });
});
