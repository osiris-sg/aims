import { XeroReportsService } from './xero-reports.service';
import { OPENING_BALANCE_SQL, isOpeningBalanceDoc } from '../common/opening-balance';

// Elroy 2026-11-21: the ABSS cutover opening-balance bills (erpImport.source 'abss-opening') have no real due date.
// Ageing puts them in their own "Opening balance" column, never in the overdue buckets.
describe('opening-balance bills in ageing', () => {
  const bill = (id: string, extra: any) => ({
    id, name: id, type: 'BILL', documentTemplateId: 't', status: 'pending_payment', createdAt: new Date('2026-11-05'),
    config: { supplierId: 's1', supplierName: 'Akron', date: '2026-11-05', dueDate: '2026-11-05', totalWithTax: 100, outstandingBalance: 100, ...extra },
  });
  const make = (rows: any[]) => {
    const prisma: any = {
      $queryRaw: jest.fn(async () => rows),
      document: { findMany: jest.fn(async () => []) },
      accountingSetting: { findUnique: jest.fn(async () => ({ baseCurrency: 'SGD', currencyRates: {} })) },
      payment: { findMany: jest.fn(async () => []) },
      customer: { findMany: jest.fn(async () => []) },
      supplier: { findMany: jest.fn(async () => [{ id: 's1', name: 'Akron', supplierCode: 'SA015' }]) },
      billPayment: { findMany: jest.fn(async () => []) },
    };
    return new XeroReportsService(prisma);
  };

  it('the rule: only erpImport.source abss-opening', () => {
    expect(isOpeningBalanceDoc({ erpImport: { source: 'abss-opening' } })).toBe(true);
    expect(isOpeningBalanceDoc({ erpImport: { source: 'old-erp' } })).toBe(false);
    expect(isOpeningBalanceDoc({})).toBe(false);
    expect(isOpeningBalanceDoc(null)).toBe(false);
    expect(OPENING_BALANCE_SQL).toBe(`COALESCE(config->'erpImport'->>'source', '') IN ('abss-opening')`);
  });

  it('summary: an opening bill sits in "Opening balance", a real bill due on the same day is aged', async () => {
    const svc = make([bill('OB-SA015', { erpImport: { source: 'abss-opening' } }), bill('SIN-1', {})]);
    const out: any = await svc.aged('org', 'payable', { asOf: '2026-11-21', level: 'summary' });
    const d = out.data;
    expect(d.bucketLabels[d.bucketLabels.length - 1]).toBe('Opening balance');
    expect(d.openingBucket).toBe(d.bucketLabels.length - 1);
    expect(d.totals[d.openingBucket]).toBe(100);
    expect(d.totals[1]).toBe(100); // the real bill, 16 days past due
    expect(d.totals[0]).toBe(0);
    expect(d.grandTotal).toBe(200);
  });

  it('detail: the opening bill is flagged; an org without any keeps its columns', async () => {
    const det: any = await make([bill('OB-SA015', { erpImport: { source: 'abss-opening' } })]).aged('org', 'payable', { asOf: '2026-11-21', level: 'detail' });
    expect(det.data.groups[0].docs[0].openingBalance).toBe(true);
    const plain: any = await make([bill('SIN-1', {})]).aged('org', 'payable', { asOf: '2026-11-21', level: 'summary' });
    expect(plain.data.openingBucket).toBeNull();
    expect(plain.data.bucketLabels).not.toContain('Opening balance');
    expect(plain.data.bucketLabels).toHaveLength(6);
  });
});
