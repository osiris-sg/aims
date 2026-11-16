import { MaintenanceReportsService } from './maintenance-reports.service';

/**
 * disableAutoCustomerEmails (WCT group, 2026-11-16): a completed / signed service
 * report is NOT emailed to the customer by the background sender when the
 * org's flag is on; every other org (flag absent) keeps the automatic email.
 */
const send = MaintenanceReportsService.prototype['sendReportEmailInBackground' as keyof MaintenanceReportsService] as any;

function service(features: Record<string, unknown>) {
  const report = {
    id: 'r1',
    organizationId: 'org-x',
    reportNumber: 3,
    serviceData: { clientEmail: 'customer@example.com', customerName: 'Customer', serviceDate: '2026-11-16' },
    organization: { name: 'Org X' },
  };
  const svc: any = Object.create(MaintenanceReportsService.prototype);
  svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  svc.prisma = {
    maintenanceServiceReport: { findUnique: jest.fn(async () => report), update: jest.fn(async () => report) },
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features })) },
  };
  svc.email = { sendServiceReportEmail: jest.fn(async () => ({ success: true })), getAdminEmail: () => 'admin@x' };
  svc.renderReportPdf = jest.fn(async () => Buffer.from('%PDF'));
  return svc;
}

describe('automatic service-report email vs disableAutoCustomerEmails', () => {
  it('flag on: nothing rendered, nothing emailed, nothing stamped', async () => {
    const svc = service({ disableAutoCustomerEmails: true });
    await send.call(svc, 'r1');
    expect(svc.email.sendServiceReportEmail).not.toHaveBeenCalled();
    expect(svc.renderReportPdf).not.toHaveBeenCalled();
    expect(svc.prisma.maintenanceServiceReport.update).not.toHaveBeenCalled();
  });

  it('flag absent (every other org): emailed and stamped as before', async () => {
    const svc = service({});
    await send.call(svc, 'r1');
    expect(svc.email.sendServiceReportEmail).toHaveBeenCalledWith(expect.objectContaining({ to: ['customer@example.com'] }));
    expect(svc.prisma.maintenanceServiceReport.update).toHaveBeenCalled();
  });

  it('only a real true switches it off', async () => {
    const svc = service({ disableAutoCustomerEmails: 'true' });
    await send.call(svc, 'r1');
    expect(svc.email.sendServiceReportEmail).toHaveBeenCalled();
  });
});
