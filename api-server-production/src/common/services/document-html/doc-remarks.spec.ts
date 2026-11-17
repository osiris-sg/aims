import { renderDocumentHtml } from './index';
import { effectiveDesign, WCT_DOC_BRAND_SETTING } from './wct-brand';
import { resolveDesign } from './design';

/**
 * Invoice + DO "Remarks" (features.enableDocRemarks, WCT group 2026-11-18): printed below the totals and above the
 * terms when typed; nothing when empty; every other org's render byte-identical.
 */
const ON = { enableDocRemarks: true };
const BC_ON = { [WCT_DOC_BRAND_SETTING]: 'BCAIR', enableDocRemarks: true };
const org = { name: 'WCT (S) SYSTEMS PTE LTD', address: '1 Test Road', phoneNumber: '6000 0000', registrationNumber: '201724603K' };
const data = (type: string, design: any, extra: any = {}) => ({
  documentType: type,
  name: 'N-1',
  organization: org,
  customer: { name: 'TEST Client', address: '1 Raffles Place' },
  items: [{ description: 'Contract of work', quantity: 1, unitPrice: 600, amount: 600 }],
  documentInfo: { documentNumber: 'N-1', date: '2026-11-18', currency: 'SGD', gstPercent: 9 },
  termsAndConditions: 'Payment within 30 days',
  design,
  ...extra,
});
const REMARKS = 'Access via loading bay\nCall Mr Tan before arrival';
const remarksIdx = (h: string) => h.indexOf('Remarks:');

describe('remarks: WCT layout (WCT (S), Racking)', () => {
  const wct = { layout: 'wct' };
  it('invoice: printed after the totals, before the terms and conditions', () => {
    const h = renderDocumentHtml('INVOICE', data('INVOICE', effectiveDesign(wct, 'INVOICE', ON), { remarks: REMARKS }), org)!;
    expect(h).toContain('Access via loading bay');
    expect(h).toContain('Call Mr Tan before arrival');
    expect(remarksIdx(h)).toBeGreaterThan(h.indexOf('Amount Due:'));
    expect(remarksIdx(h)).toBeLessThan(h.indexOf('Terms and Conditions:'));
  });
  it('DO: printed under the lines', () => {
    const h = renderDocumentHtml('DELIVERY_ORDER', data('DELIVERY_ORDER', effectiveDesign(wct, 'DELIVERY_ORDER', ON), { remarks: REMARKS }), org)!;
    expect(h).toContain('Access via loading bay');
    expect(remarksIdx(h)).toBeGreaterThan(h.indexOf('Contract of work'));
  });
  it('empty or blank remarks: no Remarks block', () => {
    for (const remarks of ['', '   ', undefined]) {
      expect(renderDocumentHtml('INVOICE', data('INVOICE', effectiveDesign(wct, 'INVOICE', ON), { remarks }), org)).not.toContain('Remarks:');
      expect(renderDocumentHtml('DELIVERY_ORDER', data('DELIVERY_ORDER', effectiveDesign(wct, 'DELIVERY_ORDER', ON), { remarks }), org)).not.toContain('Remarks:');
    }
  });
});

describe('remarks: BC Air (stock template on the WCT layout, brand BCAIR)', () => {
  it('invoice: after the totals, before its terms page', () => {
    const h = renderDocumentHtml('INVOICE', data('INVOICE', effectiveDesign(null, 'INVOICE', BC_ON), { remarks: REMARKS }), org)!;
    expect(h).toContain('<div class="wct bc">');
    expect(remarksIdx(h)).toBeGreaterThan(h.indexOf('Type of Payment:'));
    expect(remarksIdx(h)).toBeLessThan(h.indexOf('Terms &amp; Conditions:'));
  });
  it('DO: under the lines; empty: nothing', () => {
    const h = renderDocumentHtml('DELIVERY_ORDER', data('DELIVERY_ORDER', effectiveDesign(null, 'DELIVERY_ORDER', BC_ON), { remarks: REMARKS }), org)!;
    expect(h).toContain('Call Mr Tan before arrival');
    expect(renderDocumentHtml('DELIVERY_ORDER', data('DELIVERY_ORDER', effectiveDesign(null, 'DELIVERY_ORDER', BC_ON), { remarks: '' }), org)).not.toContain('Remarks:');
  });
});

describe('remarks: stock invoice (YMM, BC Air before its brand)', () => {
  it('with the setting: printed after the totals (and amount in words), before the notes / terms', () => {
    const h = renderDocumentHtml('INVOICE', data('INVOICE', effectiveDesign(null, 'INVOICE', ON), { remarks: REMARKS }), org)!;
    expect(h).toContain('Access via loading bay\nCall Mr Tan before arrival');
    expect(remarksIdx(h)).toBeGreaterThan(h.indexOf('Total SGD'));
    expect(remarksIdx(h)).toBeLessThan(h.indexOf('Terms &amp; Conditions:'));
  });
  it('remarks are escaped', () => {
    const h = renderDocumentHtml('INVOICE', data('INVOICE', effectiveDesign(null, 'INVOICE', ON), { remarks: '<script>x</script>' }), org)!;
    expect(h).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(h).not.toContain('<script>x</script>');
  });
  it('with the setting but empty: the same bytes as an invoice without the setting', () => {
    const on = renderDocumentHtml('INVOICE', data('INVOICE', effectiveDesign(null, 'INVOICE', ON), { remarks: '  ' }), org);
    const off = renderDocumentHtml('INVOICE', data('INVOICE', resolveDesign(null), { remarks: '  ' }), org);
    expect(on).toBe(off);
  });
});

describe('every other org: unchanged', () => {
  it('effectiveDesign: no docRemarks key without the setting (or for quotations / credit notes / imported docs)', () => {
    for (const f of [null, {}, { enableDocRemarks: false }, { enableDocRemarks: 'true' }, { enableQuotationSubject: true }])
      for (const t of ['INVOICE', 'DELIVERY_ORDER', 'QUOTATION']) expect(effectiveDesign({ layout: 'wct' }, t, f)).toEqual(resolveDesign({ layout: 'wct' }));
    expect(effectiveDesign(null, 'QUOTATION', ON)).toEqual(resolveDesign(null));
    expect(effectiveDesign(null, 'CREDIT_NOTE', ON)).toEqual(resolveDesign(null));
    expect(effectiveDesign(null, 'INVOICE', ON, { imported: true })).toEqual(resolveDesign(null));
  });
  it('stock invoice of an org without the setting: config.remarks is not printed (byte-identical to no remarks)', () => {
    const withRemarks = renderDocumentHtml('INVOICE', data('INVOICE', effectiveDesign(null, 'INVOICE', {}), { remarks: REMARKS }), org);
    const without = renderDocumentHtml('INVOICE', data('INVOICE', resolveDesign(null)), org);
    expect(withRemarks).toBe(without);
    expect(withRemarks).not.toContain('Access via loading bay');
  });
  it('the setting does not change a render without remarks (WCT layout, BC Air, stock)', () => {
    const pairs: Array<[string, any, any]> = [
      ['INVOICE', effectiveDesign({ layout: 'wct' }, 'INVOICE', ON), resolveDesign({ layout: 'wct' })],
      ['DELIVERY_ORDER', effectiveDesign({ layout: 'wct' }, 'DELIVERY_ORDER', ON), resolveDesign({ layout: 'wct' })],
      ['INVOICE', effectiveDesign(null, 'INVOICE', BC_ON), effectiveDesign(null, 'INVOICE', { [WCT_DOC_BRAND_SETTING]: 'BCAIR' })],
      ['INVOICE', effectiveDesign(null, 'INVOICE', ON), resolveDesign(null)],
    ];
    for (const [t, on, off] of pairs) expect(renderDocumentHtml(t, data(t, on), org)).toBe(renderDocumentHtml(t, data(t, off), org));
  });
});
