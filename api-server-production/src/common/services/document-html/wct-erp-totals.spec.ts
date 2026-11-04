import { renderWctBody } from './wct';
import { resolveDesign } from './design';

// ERP-imported WCT documents (2026-11-05) print the ERP's stored totals, even where its GST is not
// rate × subtotal (I-010944: 850 + GST 198 = 1,048), while the lines' money is unchanged.
const org = { name: 'WCT' };
const design = resolveDesign({ layout: 'wct' });
const items = [{ description: 'Service package', quantity: 1, unitPrice: 850, amount: 850 }];
const config = {
  erpImport: { source: 'wct-erp', batch: 'b', erpId: '1', originalNumber: 'I-010944' },
  items,
  grossTotal: 850,
  subTotal: 850,
  gstAmount: 198,
  nettTotal: 1048,
  gstPercent: 9,
  taxApplicable: 'Y',
};
const render = (data: any) => renderWctBody('invoice', { name: 'I-010944', documentInfo: { gstPercent: 9, taxApplicable: 'Y' }, items, ...data }, org, design);

describe('WCT imported documents print their stored totals', () => {
  it('from the saved config (email / share paths)', () => {
    const html = render({ config });
    expect(html).toContain('$198.00');
    expect(html).toContain('$1,048.00');
    expect(html).not.toContain('$76.50');
  });

  it('from the editor (preview / PDF get erpStoredTotals from the server)', () => {
    const html = render({ erpStoredTotals: { grossTotal: 850, discountAmount: 0, subTotal: 850, gstAmount: 198, nettTotal: 1048, gstPercent: 9, sig: '1.00x850.00=850.00' } });
    expect(html).toContain('$198.00');
    expect(html).toContain('$1,048.00');
  });

  it('recalculates once the lines change, and for any other document', () => {
    const changed = [{ description: 'x', quantity: 2, unitPrice: 850, amount: 1700 }];
    expect(renderWctBody('invoice', { name: 'I-010944', config, documentInfo: { gstPercent: 9 }, items: changed }, org, design)).toContain('$153.00');
    expect(render({ config: { ...config, erpImport: undefined } })).toContain('$76.50');
  });
});
