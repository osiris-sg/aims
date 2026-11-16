import { renderDocumentHtml, pdfOptionsFor } from './index';
import { effectiveDesign, WCT_DOC_BRAND_SETTING } from './wct-brand';
import { resolveDesign } from './design';

/** BC Air invoice + DO on the WCT layout (features.wctDocumentBrand = 'BCAIR', 2026-11-16). Everyone else unchanged. */
const org = { name: 'BC AIR PTE. LTD.', address: '19 Kaki Bukit Industrial Terrace, Level 3, Singapore 416099', phoneNumber: '6741 1697', email: 'admin@bcair.com.sg', registrationNumber: '202205130K' };
const data = (type: string, design: any, extra: any = {}) => ({
  documentType: type, name: 'N-1', organization: org, logoUrl: 'https://x/logo.png', customer: { name: 'TEST Client', address: '1 Raffles Place' },
  items: [{ description: 'Contract of work', quantity: 1, unitPrice: 600, amount: 600 }], documentInfo: { documentNumber: 'N-1', date: '2026-11-16', currency: 'SGD' }, design, ...extra,
});
const BC = { [WCT_DOC_BRAND_SETTING]: 'BCAIR' };

describe('effectiveDesign', () => {
  it('BC Air: a stock invoice / DO template prints on the WCT layout with the logo and the brand', () => {
    for (const t of ['INVOICE', 'DELIVERY_ORDER', 'DO', 'TI']) expect(effectiveDesign(null, t, BC)).toMatchObject({ layout: 'wct', logoPosition: 'left', brand: 'BCAIR' });
  });
  it('BC Air: quotations, credit notes and templates with a named layout keep their own design', () => {
    expect(effectiveDesign(null, 'QUOTATION', BC)).toEqual(resolveDesign(null));
    expect(effectiveDesign(null, 'CREDIT_NOTE', BC)).toEqual(resolveDesign(null));
    expect(effectiveDesign({ layout: 'wct', logoPosition: 'left' }, 'INVOICE', BC)).toEqual(resolveDesign({ layout: 'wct', logoPosition: 'left' }));
    expect(effectiveDesign({ layout: 'legacy-do' }, 'DELIVERY_ORDER', BC)).toEqual(resolveDesign({ layout: 'legacy-do' }));
  });
  it('every other org (no setting, other values, no features): exactly the template design', () => {
    for (const f of [null, {}, { enableWctOrders: true }, { [WCT_DOC_BRAND_SETTING]: 'WCT' }, { serviceReportTemplate: 'BCAIR' }])
      for (const t of ['INVOICE', 'DELIVERY_ORDER', 'QUOTATION']) expect(effectiveDesign({ accent: '#123456' }, t, f)).toEqual(resolveDesign({ accent: '#123456' }));
  });
});

describe('BC Air paper (I003278)', () => {
  const inv = renderDocumentHtml('INVOICE', data('INVOICE', effectiveDesign(null, 'INVOICE', BC)), org)!;
  it('letterhead, number, title, totals, terms, sign-off', () => {
    expect(inv).toContain('<div class="wct bc">');
    expect(inv).toContain('BC Air Pte Ltd');
    expect(inv).toContain('<b>Reg No:</b> 202205130K');
    expect(inv).toContain('<b>Paynow Reg No:</b> 202205130K001');
    expect(inv).toContain('<b>Tel:</b> 6741 1697 <b>Email:</b> admin@bcair.com.sg');
    expect(inv).toContain('Invoice No : N-1');
    expect(inv).toContain('>INVOICE</div>');
    expect(inv).not.toContain('TAX INVOICE');
    for (const l of ['Total Amount:', 'Discount:', 'Amount Paid:', 'Amount Due:', 'Type of Payment:']) expect(inv).toContain(l);
    expect(inv).toContain('Terms &amp; Conditions:');
    expect(inv).toContain('Bank: OCBC Account No: 604-567-263-001 Type of account: Current');
    expect(inv).toContain('within three (12) months');
    expect(inv).toContain('Ms Yew');
    expect(inv).toContain('Admin Manager of');
    expect(inv).toContain('Confirmation of Order :');
    expect(inv).not.toMatch(/Company Reg:|GST Reg No:|Sales Person:/);
  });
  it("a document's own terms win over the default ones", () => {
    const h = renderDocumentHtml('INVOICE', data('INVOICE', effectiveDesign(null, 'INVOICE', BC), { termsAndConditions: 'Own terms' }), org)!;
    expect(h).toContain('Own terms');
    expect(h).not.toContain('604-567-263-001');
  });
  it('DO: BC letterhead, the WCT DO body', () => {
    const h = renderDocumentHtml('DELIVERY_ORDER', data('DELIVERY_ORDER', effectiveDesign(null, 'DELIVERY_ORDER', BC)), org)!;
    expect(h).toContain('Delivery Order No : N-1');
    expect(h).toContain('Sold To:');
    expect(h).toContain('<b>Paynow Reg No:</b>');
  });
  it('PDF footer: "Page n | N" over the thank-you line; WCT keeps its own footer', () => {
    expect(pdfOptionsFor('INVOICE', data('INVOICE', effectiveDesign(null, 'INVOICE', BC)))?.pageNumbers).toMatchObject({ format: 'stacked', label: 'Thank You for Your Patronage . We look forward to serving you again!', italic: true });
    expect(pdfOptionsFor('INVOICE', data('INVOICE', { layout: 'wct' }, { footerMessage: 'WCT line' }))?.pageNumbers).toEqual({ label: 'WCT line', format: 'slash', fontPx: 10, paddingX: '14mm' });
  });
  it("BC Air's quotation (already on the WCT layout) is untouched by the brand", () => {
    const q1 = renderDocumentHtml('QUOTATION', data('QUOTATION', effectiveDesign({ layout: 'wct', logoPosition: 'left' }, 'QUOTATION', BC)), org);
    const q2 = renderDocumentHtml('QUOTATION', data('QUOTATION', resolveDesign({ layout: 'wct', logoPosition: 'left' })), org);
    expect(q1).toBe(q2);
  });
});

describe('imported documents keep their look', () => {
  it('an imported (ABSS / ERP) BC Air invoice or DO: the template design, no brand', () => {
    expect(effectiveDesign(null, 'INVOICE', BC, { imported: true })).toEqual(resolveDesign(null));
    expect(effectiveDesign(null, 'DELIVERY_ORDER', BC, { imported: true })).toEqual(resolveDesign(null));
    expect(effectiveDesign(null, 'INVOICE', BC, { imported: false })).toMatchObject({ layout: 'wct', brand: 'BCAIR' });
  });
});
