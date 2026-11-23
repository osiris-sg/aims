import { renderDocumentHtml, pdfOptionsFor, WCT_PDF_MARGIN } from './index';
import { WCT_DOC_BRAND_SETTING, effectiveDesign } from './wct-brand';

/**
 * WCT group print (2026-11-23): every text size 2px smaller than before (logo + script signature fonts unchanged),
 * and page-margin spacer rows in the sheet's repeating thead / tfoot that are 0 high outside the portal's browser
 * print (ServerDocumentPreview gives them ~12mm with @page margin 0). The server PDF keeps its margins + footer.
 */
const org = { name: 'WCT (S) SYSTEMS PTE LTD', address: '1 Test Road', phoneNumber: '6000 0000', email: 'a@b.c', registrationNumber: '200000000A' };
const data = (type: string, design: any, extra: any = {}) => ({
  documentType: type, name: 'Q-1', organization: org, logoUrl: 'https://x/logo.png', customer: { name: 'TEST Client', address: '1 Raffles Place' },
  items: [{ description: 'Line', quantity: 1, unitPrice: 100, amount: 100 }],
  documentInfo: { documentNumber: 'Q-1', date: '2026-11-23', currency: 'SGD', remarks: 'Some remarks', termsAndConditions: 'Some terms' },
  remarks: 'Some remarks', termsAndConditions: 'Some terms', design, ...extra,
});
const WCT = { layout: 'wct', logoPosition: 'left' };
const BC = effectiveDesign(null, 'INVOICE', { [WCT_DOC_BRAND_SETTING]: 'BCAIR' });
const RK = { ...WCT, racking: true };

const sizeOf = (html: string, selector: string): string | undefined => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)\\s*${esc} \\{[^}]*?font-size: ([\\d.]+px)`).exec(html)?.[1];
};

describe('WCT print: text 2px smaller', () => {
  const q = renderDocumentHtml('QUOTATION', data('QUOTATION', WCT), org)!;
  it('default WCT sizes (body 12.5 -> 10.5, title 16 -> 14, ...)', () => {
    const want: Record<string, string> = {
      '.wct': '10.5px',
      '.wct .lh .co': '9.5px',
      '.wct .lh .co .nm': '12px',
      '.wct .docno': '11px',
      '.wct .title': '14px',
      '.wct .stars': '8px',
      'table.wct-lines th': '10.5px',
      'table.wct-lines td': '10.5px',
      '.wct .totals td': '10.5px',
      '.wct .tnc h3': '10.5px',
      '.wct .tnc p, .wct .tnc div': '10px',
      '.wct .rcv .box .ln': '9.5px',
      '.wct .proof h3': '12px',
      '.wct .closing .stamp .who': '8.5px',
    };
    for (const [sel, px] of Object.entries(want)) expect([sel, sizeOf(q, sel)]).toEqual([sel, px]);
    // The title stays the largest heading.
    expect(parseFloat(sizeOf(q, '.wct .title')!)).toBeGreaterThan(parseFloat(sizeOf(q, '.wct .lh .co .nm')!));
    // Inline remarks / terms styles.
    expect(q).toContain('font-size:10.5px;line-height:1.5;');
    expect(q).toContain('font-size:10px;line-height:1.6;');
    expect(q).not.toMatch(/font-size:\s*12\.5px/);
    // Line-item description (the shared cell is 13px; WCT prints it at 11px).
    expect(q).toContain('<p style="font-size:11px;line-height:1.6;');
    expect(q).not.toContain('font-size:13px;');
    // The logo size is unchanged.
    expect(q).toContain('.wct .lh img { max-height: 62px; max-width: 200px;');
  });
  it('BC Air: smaller letterhead + terms, script signature unchanged', () => {
    const h = renderDocumentHtml('INVOICE', data('INVOICE', BC), org)!;
    expect(sizeOf(h, '.wct.bc .lh .co .nm')).toBe('16px');
    expect(sizeOf(h, '.wct.bc .lh .co')).toBe('10.5px');
    expect(sizeOf(h, '.wct.bc .tnc .ln')).toBe('10px');
    expect(sizeOf(h, '.wct.bc .bcsign .scr')).toBe('28px');
    expect(h).toContain('.wct.bc .lh img { max-height: 80px; }');
  });
  it('Racking: smaller footer text, script signature + logo unchanged', () => {
    const h = renderDocumentHtml('QUOTATION', data('QUOTATION', RK), org)!;
    expect(sizeOf(h, '.wct.rk .rkfoot')).toBe('10px');
    expect(sizeOf(h, '.wct.rk .rksig .scr')).toBe('30px');
    expect(h).toContain('.wct.rk .lh img { max-height: 86px; max-width: 120px; }');
  });
});

describe('WCT print: page-margin spacer rows', () => {
  for (const [name, type, design] of [['WCT quotation', 'QUOTATION', WCT], ['WCT invoice', 'INVOICE', WCT], ['WCT DO', 'DELIVERY_ORDER', WCT], ['BC Air invoice', 'INVOICE', BC], ['Racking quotation', 'QUOTATION', RK]] as const) {
    it(`${name}: top spacer in the repeating thead, bottom spacer in a tfoot, 0 high outside browser print`, () => {
      const h = renderDocumentHtml(type, data(type, design), org)!;
      expect(h).toMatch(/<table class="wct-sheet"><thead><tr class="wct-pgtop"><td><\/td><\/tr><tr><td>/);
      expect(h).toMatch(/<\/tbody><tfoot><tr class="wct-pgbot"><td><\/td><\/tr><\/tfoot><\/table>/);
      expect(h).toContain('table.wct-sheet > thead > tr.wct-pgtop > td, table.wct-sheet > tfoot > tr.wct-pgbot > td { height: 0; padding: 0;');
      // No page-margin override in the server HTML: the PDF keeps Puppeteer's margins.
      expect(h).not.toMatch(/@page\s*\{[^}]*margin/);
      expect(h).not.toMatch(/\.wct-pg(top|bot)[^{]*\{[^}]*height:\s*12mm/);
    });
  }
  it('the server PDF keeps its margins and footer', () => {
    expect(WCT_PDF_MARGIN).toEqual({ top: '12mm', right: '14mm', bottom: '18mm', left: '14mm' });
    expect(pdfOptionsFor('QUOTATION', data('QUOTATION', WCT))).toMatchObject({ margin: WCT_PDF_MARGIN, pageNumbers: { format: 'slash', fontPx: 10 } });
  });
});
