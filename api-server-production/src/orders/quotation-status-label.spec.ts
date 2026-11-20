import { quotationStatusLabel } from './quotation-status-label';

// Round 39 (WCT group): the jobs calendar side panel's quotation chip shows the real status, never "Imported".
describe('quotationStatusLabel', () => {
  const erp = (status: string, extra: any = {}) => ({ type: 'QUOTATION', status: 'confirmed', config: { date: '2026-11-01', erpImport: { source: 'wct-erp', status, ...extra } } });
  const today = '2026-11-20';

  it('old ERP quotations read as the documents list reads them', () => {
    expect(quotationStatusLabel(erp('Accepted'), { today })).toBe('Confirmed');
    expect(quotationStatusLabel(erp('Draft'), { today })).toBe('Unconfirmed · ERP draft');
    expect(quotationStatusLabel(erp('Sent'), { today })).toBe('Unconfirmed · ERP sent');
    expect(quotationStatusLabel({ ...erp('Draft'), config: { date: '2025-01-10', erpImport: { source: 'wct-erp', status: 'Draft' } } }, { today })).toBe('Expired · ERP draft');
    expect(quotationStatusLabel(erp('Declined'), { today })).toBe('Declined');
    // Confirmed by the owner in AIMS: the stored status.
    expect(quotationStatusLabel(erp('Draft', { ownerConfirmed: true }), { today })).toBe('Confirmed');
  });

  it('AIMS quotations: their own status', () => {
    expect(quotationStatusLabel({ type: 'QUOTATION', status: 'unconfirmed', config: {} })).toBe('Unconfirmed');
    expect(quotationStatusLabel({ type: 'QUOTATION', status: 'confirmed', config: {} })).toBe('Confirmed');
    expect(quotationStatusLabel({ type: 'QUOTATION', status: 'confirmed', config: { voided: true } })).toBe('Voided');
    expect(quotationStatusLabel(null)).toBe('');
  });
});
