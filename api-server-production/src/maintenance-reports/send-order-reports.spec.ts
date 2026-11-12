import { BadRequestException } from '@nestjs/common';
import { MaintenanceReportsService } from './maintenance-reports.service';

/**
 * Manual order flow (2026-11-12): "Send service report to customer" for an
 * order, and uploading the file into a job's draft report. Built without Nest.
 */
const ORG = 'org-wct';
const MANUAL = { enableManualOrderFlow: true, enableWctOrders: true };

function service(opts: { features?: Record<string, any>; emailOk?: boolean } = {}) {
  const reports: any[] = [
    { id: 'r1', organizationId: ORG, kind: 'SERVICE', status: 'completed', reportNumber: 7, deliveryId: 'j1', serviceData: { uploaded: true, uploadedFile: { key: 'k', mimeType: 'application/pdf' }, photosFile: { key: 'p', mimeType: 'image/jpeg' }, serviceDate: '2026-11-13' } },
    { id: 'r2', organizationId: ORG, kind: 'SERVICE', status: 'completed', reportNumber: 8, deliveryId: 'j2', serviceData: { serviceDate: '2026-11-14' } },
    { id: 'r3', organizationId: ORG, kind: 'SERVICE', status: 'draft', reportNumber: null, deliveryId: 'j3', serviceData: { scheduled: true, manualFlow: true, orderId: 'o1' } },
  ];
  const order: any = { id: 'o1', orderNumber: 'ORD-1', attachments: [], statusDates: { DO_DRAFT: 'x' }, customer: { name: 'Golden Wok', email: 'shop@example.com' } };
  const svc: any = Object.create(MaintenanceReportsService.prototype);
  const emails: any[] = [];
  svc.prisma = {
    organizationUIConfig: { findUnique: async () => ({ features: opts.features ?? MANUAL }) },
    order: { findFirst: async () => order, update: async ({ data }: any) => Object.assign(order, data), findMany: async () => [] },
    delivery: { findMany: async () => [{ id: 'j1' }, { id: 'j2' }, { id: 'j3' }], findFirst: async () => ({ orderId: 'o1' }) },
    maintenanceServiceReport: {
      findMany: async ({ where }: any) => reports.filter((r) => r.status === where.status && where.OR[0].deliveryId.in.includes(r.deliveryId)),
      findFirst: async ({ where }: any) => (where.id ? reports.find((r) => r.id === where.id) ?? null : { reportNumber: 8 }),
      update: async ({ where, data, select }: any) => {
        const row = Object.assign(reports.find((r) => r.id === where.id), data);
        return select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : row;
      },
    },
    organization: { findUnique: async () => ({ name: 'WCT' }) },
    document: { findMany: async () => [] },
  };
  svc.getReportPdf = async (id: string) => ({ buffer: Buffer.from(`pdf-${id}`), filename: `service-report-${id}.pdf`, contentType: 'application/pdf' });
  svc.getPhotosFile = async (id: string) => ({ buffer: Buffer.from(`photos-${id}`), filename: `service-report-${id}-photos.jpg`, contentType: 'image/jpeg' });
  svc.email = { sendServiceReportEmail: async (p: any) => { emails.push(p); return opts.emailOk === false ? { success: false, error: 'API key is invalid' } : { success: true }; } };
  svc.ordersService = { addOrderAttachment: jest.fn(async () => []) };
  return { svc: svc as MaintenanceReportsService, reports, order, emails };
}

describe('send service report to customer (manual order flow)', () => {
  it('one email with every completed report (as stored) plus its photos file; stamps the reports and the order', async () => {
    const { svc, reports, order, emails } = service();
    const r = await svc.sendOrderReportsToCustomer('o1', {}, ORG);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toEqual(['shop@example.com']);
    expect(emails[0].extraAttachments.map((a: any) => a.filename)).toEqual(['service-report-r1.pdf', 'service-report-r1-photos.jpg', 'service-report-r2.pdf']);
    expect(emails[0].pdfBuffer).toBeUndefined();
    expect(r).toMatchObject({ sentTo: ['shop@example.com'], reports: [7, 8], attachments: 3 });
    expect(reports[0].serviceData.customerSentAt).toBeTruthy();
    expect(reports[2].serviceData.customerSentAt).toBeUndefined(); // the draft is not sent
    expect(order.statusDates.serviceReportSentAt).toBeTruthy();
    expect(order.statusDates.DO_DRAFT).toBe('x');
  });

  it('a typed address wins; a bad one is refused before sending', async () => {
    const a = service();
    await a.svc.sendOrderReportsToCustomer('o1', { to: 'a@x.com, b@y.com' }, ORG);
    expect(a.emails[0].to).toEqual(['a@x.com', 'b@y.com']);
    const b = service();
    await expect(b.svc.sendOrderReportsToCustomer('o1', { to: 'not-an-email' }, ORG)).rejects.toBeInstanceOf(BadRequestException);
    expect(b.emails).toHaveLength(0);
  });

  it('a failed send stamps nothing', async () => {
    const { svc, order, reports } = service({ emailOk: false });
    await expect(svc.sendOrderReportsToCustomer('o1', {}, ORG)).rejects.toThrow('API key is invalid');
    expect(order.statusDates.serviceReportSentAt).toBeUndefined();
    expect(reports[0].serviceData.customerSentAt).toBeUndefined();
  });

  it('refused without the manual flow (every other org)', async () => {
    for (const features of [{}, { enableWctOrders: true }, { enableIdQuotation: true }]) {
      const { svc, emails } = service({ features });
      await expect(svc.sendOrderReportsToCustomer('o1', {}, ORG)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.completeDraftByUpload('r3', { fileKey: `maintenance-reports/${ORG}/x.pdf`, mimeType: 'application/pdf' }, ORG, 'u')).rejects.toBeInstanceOf(BadRequestException);
      expect(emails).toHaveLength(0);
    }
  });

  it("uploading into the job's draft: completed, next number, put on the order, never emailed", async () => {
    const { svc, reports, emails } = service();
    const out = await svc.completeDraftByUpload('r3', { fileKey: `maintenance-reports/${ORG}/uploads/sr.pdf`, fileName: 'sr.pdf', mimeType: 'application/pdf' }, ORG, 'u1');
    expect(out).toEqual({ id: 'r3', reportNumber: 9 });
    expect(reports[2]).toMatchObject({ status: 'completed', reportNumber: 9, serviceData: { uploaded: true, manualFlow: true, uploadedFile: { fileName: 'sr.pdf' } } });
    expect(reports[2].serviceData.scheduled).toBeUndefined();
    expect((svc as any).ordersService.addOrderAttachment).toHaveBeenCalledWith('o1', ORG, { kind: 'report', reportId: 'r3' }, { id: 'u1' });
    expect(emails).toHaveLength(0);
    await expect(svc.completeDraftByUpload('r3', { fileKey: `maintenance-reports/${ORG}/uploads/sr.pdf`, mimeType: 'application/pdf' }, ORG, 'u1')).rejects.toThrow(/already completed/);
  });
});
