import { renderWctBody } from './wct';
import { resolveDesign } from './design';

const base = (extra: any = {}) => ({
  name: 'QO-1',
  customer: { name: 'ACME', address: '10 Jurong West St 41 639273' },
  documentInfo: { date: '2026-11-24', jobLocation: 'E!Avenue #02-346, 639273', ...(extra.documentInfo || {}) },
  items: [{ description: 'Line', quantity: 1, unitPrice: 10, amount: 10 }],
  ...extra,
});
const design = resolveDesign({ layout: 'wct' } as any);

describe('WCT print: company stamp + Singapore', () => {
  it('prints no stamp unless ticked', () => {
    for (const k of ['quotation', 'invoice', 'do'] as const) expect(renderWctBody(k, base(), {}, design)).not.toContain('class="cstamp"');
  });
  it('prints the org stamp when ticked, the SAMPLE stamp when the org has none', () => {
    for (const k of ['quotation', 'invoice', 'do'] as const) {
      const own = renderWctBody(k, base({ documentInfo: { addCompanyStamp: true }, stampUrl: 'https://x/stamp.png' }), {}, design);
      expect(own).toContain('<div class="cstamp"><img src="https://x/stamp.png"');
      const sample = renderWctBody(k, base({ documentInfo: { addCompanyStamp: true } }), {}, design);
      expect(sample).toContain('class="cstamp"><img src="data:image/svg+xml;base64,');
    }
  });
  it('adds Singapore to addresses ending in a postal code', () => {
    const q = renderWctBody('quotation', base(), {}, design);
    expect(q).toContain('10 Jurong West St 41 Singapore 639273');
    expect(q).toContain('E!Avenue #02-346 Singapore 639273');
    const d = renderWctBody('do', base(), {}, design);
    expect(d).toContain('10 Jurong West St 41 Singapore 639273');
  });
});
