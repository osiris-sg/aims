import { XeroReportsService, SCAN_SKIP_KEYS } from './xero-reports.service';

// Outage 19 Nov 2026: the aged report loaded every invoice's full JSON. The scan now leaves the heavy keys in the
// database (SQL `config - keys`); the rows it builds come from money, dates, contact and reference only.
describe('XeroReportsService document scan (light load)', () => {
  const inv = {
    id: 'i1', name: 'I-1', type: 'INVOICE', documentTemplateId: 't', status: 'pending_payment', createdAt: new Date('2026-10-01'),
    config: { customerId: 'c1', customerName: 'Kopi', date: '2026-10-01', dueDate: '2026-10-31', totalWithTax: 109, outstandingBalance: 109, gstAmount: 9, subTotal: 100, referenceNo: 'R1' },
  };
  const prisma: any = {
    $queryRaw: jest.fn(async () => [inv]),
    document: { findMany: jest.fn(async () => { throw new Error('the scan must not load full documents'); }) },
    accountingSetting: { findUnique: jest.fn(async () => ({ baseCurrency: 'SGD', currencyRates: {} })) },
    payment: { findMany: jest.fn(async () => []) },
    customer: { findMany: jest.fn(async () => [{ id: 'c1', name: 'Kopi', customerCode: 'CK1' }]) },
  };
  it('reads through the light SQL (heavy keys stripped) and ages the invoice as before', async () => {
    const svc = new XeroReportsService(prisma);
    const out: any = await svc.aged('org', 'receivable', { asOf: '2026-11-19', level: 'detail' });
    const sql = (prisma.$queryRaw.mock.calls[0][0] as string[]).join('?');
    expect(sql).toMatch(/config - \?::text\[\]/);
    expect(prisma.$queryRaw.mock.calls[0]).toContain(SCAN_SKIP_KEYS);
    expect(SCAN_SKIP_KEYS).toEqual(expect.arrayContaining(['items', 'termsAndConditions']));
    for (const k of ['totalWithTax', 'outstandingBalance', 'customerId', 'customerName', 'date', 'dueDate', 'referenceNo', 'currency', 'documentInfo']) expect(SCAN_SKIP_KEYS).not.toContain(k);
    expect(JSON.stringify(out)).toContain('109');
    expect(prisma.document.findMany).not.toHaveBeenCalled();
  });
});
