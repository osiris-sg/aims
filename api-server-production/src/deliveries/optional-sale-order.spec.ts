import { saleOrderMissing } from './optional-sale-order';

describe('Sales Order on a scheduled delivery (enableOptionalSaleOrder)', () => {
  const base = { isDraft: false, saleOrderId: null, serviceJobOrg: false, optionalSaleOrder: false };

  it('still requires a Sales Order for orgs without either flag (every other org)', () => {
    expect(saleOrderMissing(base)).toBe(true);
  });

  it('lets an org with enableOptionalSaleOrder schedule with none (Biofuel)', () => {
    expect(saleOrderMissing({ ...base, optionalSaleOrder: true })).toBe(false);
  });

  it('keeps the WCT service-job exemption exactly as before', () => {
    expect(saleOrderMissing({ ...base, serviceJobOrg: true })).toBe(false);
  });

  it('never complains about drafts or when a Sales Order is given', () => {
    expect(saleOrderMissing({ ...base, isDraft: true })).toBe(false);
    expect(saleOrderMissing({ ...base, saleOrderId: 'so-1' })).toBe(false);
  });
});
