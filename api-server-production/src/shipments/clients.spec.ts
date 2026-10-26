/** Round AM — Clients: list figures, contacts from intake senders, the Document formats tab. */
import { clientStats, contactsFrom, formatViews, generatorFits } from './clients';
import { profileFor } from './trade-profile';

describe('Clients', () => {
  it('figures: open orders, tons this month / the 3 months before, last delivery', () => {
    const s = clientStats(
      [
        { orderNo: 19, status: 'OPEN', qtyMt: 300, deliveryMonth: '2026-10', shipMonth: '2026-08', shipments: [] },
        { orderNo: 16, status: 'OPEN', qtyMt: 120, deliveryMonth: '2026-09', shipMonth: '2026-08', shipments: [{ seqNo: 1, status: 'COMPLETED', blNumber: 'x', etd: null, eta: '2026-09-28', steps: [] }] },
        { orderNo: 8, status: 'COMPLETED', qtyMt: 300, deliveryMonth: '2026-08', shipMonth: '2026-06', shipments: [] },
        { orderNo: 27, status: 'OPEN', isTest: true, qtyMt: 999, deliveryMonth: '2026-10', shipMonth: null, shipments: [] },
      ],
      '2026-10-26',
    );
    expect(s).toMatchObject({ openOrders: 2, tonsThisMonth: 300, tonsLast3Months: 420, last3From: '2026-07', last3To: '2026-09', lastDelivery: { date: '2026-09-28', ref: '#16-1' } });
  });
  it('contacts: incoming mail by profile key or domain, own domain and outgoing left out', () => {
    const rows = [
      { fromAddress: 'arima-h@sus.co.jp', direction: 'IN', counterparty: 'SUS', emailDate: '2026-10-20', createdAt: '2026-10-20' },
      { fromAddress: 'arima-h@sus.co.jp', direction: 'IN', counterparty: 'SUS', emailDate: '2026-10-24', createdAt: '2026-10-24' },
      { fromAddress: 'kanai@katokei.co.jp', direction: 'IN', counterparty: 'OTHER', emailDate: null, createdAt: '2026-10-01' },
      { fromAddress: 'finance@asiadealhub.com', direction: 'OUT', counterparty: 'SUS', emailDate: null, createdAt: '2026-10-01' },
    ];
    expect(contactsFrom(rows, ['SUS'], [], ['asiadealhub.com'])).toEqual([{ email: 'arima-h@sus.co.jp', messages: 2, lastAt: '2026-10-24' }]);
    expect(contactsFrom(rows, ['KATO'], ['katokei.co.jp']).map((c) => c.email)).toEqual(['kanai@katokei.co.jp']);
  });
  it('document formats: step 4 generators selectable, invoice follows billing, 宛先 falls back', () => {
    const p = profileFor({ c: { billingMode: 'TWO_STAGE', truckCapacityT: 20, docAddressee: 'SUS株式会社 福島製造グループ', docVariants: { CUSTOMER_COA: 'CUSTOMER_COA_SUS_SUMMARY' }, docFormats: { CUSTOMER_PL: { samples: [{ id: 's', fileName: 'PACKING LIST.XLS.xlsx', mimeType: 'x', sizeBytes: 1, s3Key: 'secret', uploadedAt: 'd' }] } } } }, 'c');
    const v = formatViews(p, 'SUS株式会社');
    expect(v.map((x) => [x.docType, x.step, x.generator, x.choose])).toEqual([
      ['CUSTOMER_COA', '4', 'CUSTOMER_COA_SUS_SUMMARY', 'variant'],
      ['CUSTOMER_PL', '4', 'CUSTOMER_PL_KATO', 'variant'],
      ['SGJP_IV_PL', '7', 'SGJP_IV_PL', 'fixed'],
      ['SHIPPING_INSTRUCTIONS', '9', 'SHIPPING_INSTRUCTIONS', 'fixed'],
      ['INVOICE', '11', 'INVOICE_2', 'billing'],
    ]);
    expect(v[0].options.map((o) => o.key)).toContain('CUSTOMER_COA_SUS_SUMMARY');
    expect(v[0].effectiveAddressee).toBe('SUS株式会社 福島製造グループ');
    expect(v[1].samples[0]).not.toHaveProperty('s3Key');
    expect(generatorFits('CUSTOMER_PL', 'CUSTOMER_PL_SUS_XLS')).toBe(true);
    expect(generatorFits('CUSTOMER_PL', 'CUSTOMER_COA_SUS_SUMMARY')).toBe(false);
  });
});
