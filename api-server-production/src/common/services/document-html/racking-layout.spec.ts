import { renderDocumentHtml, pdfOptionsFor } from './index';
import { effectiveDesign } from './wct-brand';
import { resolveDesign } from './design';

/** WCT Racking quotation on the WCT layout (features.enableRackingLayout, 2026-11-18). Everyone else unchanged. */
const RK = { enableRackingLayout: true };
const TPL = { layout: 'wct', logoPosition: 'left', titleText: 'QUOTATION' };
const org = { name: 'WCT Racking Pte Ltd', address: '19 Kaki Bukit Industrial Terrace, Level 3, Singapore 416099', registrationNumber: '202100255Z', phoneNumber: '6741 1697' };
const items = [
  { description: 'Heavy Duty Racking Works', isGroupHeader: true },
  { description: 'End frame', quantity: 8, uom: 'pcs', unitPrice: 200, amount: 1600 },
  { description: 'Box beam', quantity: 16, uom: '', unitPrice: 50, amount: 800 },
  { description: 'Pre Renovation works', isGroupHeader: true },
  { description: 'Delivery and installation', quantity: 1, uom: 'lot', unitPrice: 800, amount: 800 },
];
const FOOTER =
  'Payment Terms:\nFirst Payment - 50% Upon confirmation\n\nPAYMENT METHOD:\n• Pay Now Method: 202100255Z001\n\nTerms and Conditions:\n• Terms & Conditions may change without prior notice to customer';
const data = (type: string, design: any, info: any = {}, extra: any = {}) => ({
  documentType: type, name: 'WR-QO-1', organization: org, customer: { name: 'TEST Client', address: '1 Raffles Place' }, items, design,
  documentInfo: { documentNumber: 'WR-QO-1', date: '2026-11-18', currency: 'SGD', salesPersonName: 'Nee Meng Tan', salesContact: '9181 9107', taxApplicable: 'N', gstPercent: 9, ...info },
  termsAndConditions: FOOTER, footerMessage: 'This is computer generated, no signature is required', ...extra,
});
const quote = (info: any = {}, extra: any = {}) => renderDocumentHtml('QUOTATION', data('QUOTATION', effectiveDesign(TPL, 'QUOTATION', RK), info, extra), org)!;

describe('effectiveDesign: racking', () => {
  it('stamps racking on WCT-layout quotation / invoice / DO templates of an org with the flag', () => {
    for (const t of ['QUOTATION', 'INVOICE', 'DELIVERY_ORDER']) expect(effectiveDesign(TPL, t, RK)).toMatchObject({ layout: 'wct', racking: true });
  });
  it('never for a stock (non-WCT) template, an imported document, or an org without the flag', () => {
    expect(effectiveDesign(null, 'QUOTATION', RK)).toEqual(resolveDesign(null));
    expect(effectiveDesign(TPL, 'INVOICE', RK, { imported: true })).toEqual(resolveDesign(TPL));
    for (const f of [null, {}, { enableRackingLayout: false }, { enableRackingLayout: 'true' }, { wctDocumentBrand: 'BCAIR' }, { enableWctOrders: true, enableDocRemarks: true }])
      for (const t of ['QUOTATION', 'INVOICE', 'DELIVERY_ORDER']) expect((effectiveDesign(TPL, t, f) as any).racking).toBeUndefined();
  });
});

describe('Racking quotation', () => {
  it('payment terms always start a new page (the heading carries the page break)', () => {
    const h = quote();
    expect(h).toContain('<div class="hd pb">PAYMENT TERMS:</div>');
    expect((h.match(/class="hd pb"/g) || []).length).toBe(1);
    expect(h).toMatch(/\.wct\.rk \.rkfoot \.pb \{[^}]*page-break-before: always/);
    // Terms with no PAYMENT TERMS heading: the page break sits before the terms as a whole.
    const plain = quote({}, { termsAndConditions: 'Goods sold are not returnable' });
    expect(plain).toContain('<div class="pb"><div class="hd">TERMS &amp; CONDITIONS:</div>');
    // A Racking invoice and every other org's quotation carry no such break.
    const inv = renderDocumentHtml('INVOICE', data('INVOICE', effectiveDesign(TPL, 'INVOICE', RK)), org)!;
    expect(inv).not.toMatch(/class="(hd )?pb"/);
    const wct = renderDocumentHtml('QUOTATION', data('QUOTATION', effectiveDesign(TPL, 'QUOTATION', {})), org)!;
    expect(wct).not.toMatch(/class="(hd )?pb"/);
  });
  it('section titles take no S/No (first item is 1) and print as a full-width row', () => {
    const h = quote();
    expect([...h.matchAll(/<td class="no">(\d*)<\/td>/g)].map((m) => m[1])).toEqual(['1', '2', '3']);
    expect(h).toContain('<td colspan="6" style="font-weight:700;text-decoration:underline;">Heavy Duty Racking Works</td>');
  });
  it('UOM column between Qty and Unit Price; blank prints blank', () => {
    const h = quote();
    expect(h).toMatch(/Qty<\/th><th style="text-align:center;width:64px;">UOM<\/th><th[^>]*>Unit Price/);
    expect(h).toContain('<td class="qty">pcs</td>');
    expect(h).toContain('<td class="qty"></td>');
  });
  it('no discount: just Total Amount; no GST line', () => {
    const h = quote();
    expect(h).toContain('Total Amount:</td><td class="v">$3,200.00');
    expect(h).not.toMatch(/Goodwill Discount|Final Amount|GST \d/);
  });
  it('Goodwill Discount: Total Amount / Goodwill Discount / Final Amount', () => {
    const h = quote({ discountAmount: 200 });
    expect(h).toContain('Total Amount:</td><td class="v">$3,200.00');
    expect(h).toContain('Goodwill Discount:</td><td class="v">$200.00');
    expect(h).toContain('Final Amount:</td><td class="v">$3,000.00');
    expect(h).not.toMatch(/>Total:<|>Discount:</);
  });
  it('a quotation that still has GST on prints the GST line before the Final Amount', () => {
    const h = quote({ taxApplicable: 'Y' });
    expect(h).toMatch(/Total Amount:.*GST 9%:.*Final Amount:<\/td><td class="v">\$3,488\.00/s);
  });
  it('letterhead: Company Reg only, no GST Reg No', () => {
    const h = quote();
    expect(h).toContain('Company Reg: 202100255Z');
    expect(h).not.toContain('GST Reg No');
  });
  it('footer: no Remarks heading, headings in capitals, notes print above the terms', () => {
    const h = quote({}, { note: 'Site access from 9am', remarks: '' });
    expect(h).not.toContain('Remarks:');
    expect(h).not.toContain('Terms and Conditions:');
    for (const x of ['<div class="hd pb">PAYMENT TERMS:</div>', '<div class="hd">PAYMENT METHOD:</div>', '<div class="hd">TERMS &amp; CONDITIONS:</div>']) expect(h).toContain(x);
    expect(h.indexOf('Site access from 9am')).toBeLessThan(h.indexOf('PAYMENT TERMS:'));
    expect(h).toContain('<div class="bl"><span>•</span><span>Pay Now Method: 202100255Z001</span></div>');
  });
  it('terms without a heading get TERMS & CONDITIONS; rich-text headings are put in capitals', () => {
    const h1 = quote({}, { termsAndConditions: '- Goods remain ours' });
    expect(h1).toContain('<div class="hd">TERMS &amp; CONDITIONS:</div><div class="bl"><span>-</span><span>Goods remain ours</span></div>');
    const h2 = quote({}, { termsAndConditions: '<b>Payment terms: </b><div>50%</div><div><b>Terms &amp; Conditions:</b></div>' });
    expect(h2).toContain('<b>PAYMENT TERMS: </b>');
    expect(h2).toContain('<b>TERMS &amp; CONDITIONS:</b>');
    expect(h2.match(/TERMS &amp; CONDITIONS:/g)?.length).toBe(1);
  });
  it('sign-off: Yours Sincerely, / signer in script / "<title> of" / company in orange; no computer-generated line', () => {
    const h = quote({ signedBy: 'Tan Ah Kow', signedByTitle: 'Director' });
    expect(h).toContain('<div class="rksig"><div>Yours Sincerely,</div><div class="scr">Tan Ah Kow</div><div>Director of</div><div class="co">WCT Racking Pte Ltd</div></div>');
    expect(h).toMatch(/\.wct\.rk \.rksig \.co \{ color: #E8731A;/);
    expect(h).not.toMatch(/computer generated|Director of WCT Racking|Yours Sincerely<\/p>/);
    expect(pdfOptionsFor('QUOTATION', data('QUOTATION', effectiveDesign(TPL, 'QUOTATION', RK)))?.pageNumbers?.label).toBe('');
  });
  it('Signed by defaults to the salesperson, title to Manager; a raw user id never prints', () => {
    expect(quote()).toContain('<div class="scr">Nee Meng Tan</div><div>Manager of</div>');
    const noName = quote({ salesPersonName: '', salesPerson: 'user_3Ld8L6i0KO2BXMybjx5mYkWUdoh' });
    expect(noName).toContain('<div class="scr">&nbsp;</div>');
    expect(noName).toContain('<p>Sales Person: </p>');
    expect(noName).not.toContain('user_3Ld8');
  });
  it('the customer e-signature still lands on the stamp line', () => {
    const SIG = 'data:image/png;base64,iVBORw0KGgo=';
    const h = quote({}, { config: { clientSignature: { image: SIG, name: 'Client', signedAt: '2026-11-18T09:00:00+08:00' } } });
    expect(h).toContain('<div class="closing signed">');
    expect(h).toContain(`<div class="stamp"><img class="sigimg" src="${SIG}" alt="" />Company Stamp &amp; Authorized Signature<div class="who">Client &nbsp;·&nbsp; 18/11/2026</div></div>`);
    expect(h).toContain('<div class="r">Confirmation of Order</div>');
  });
});

describe('Racking invoice and DO', () => {
  const INV_TERMS = 'PAYMENT METHOD:\n• Pay Now Method: 202100255Z001\n\nTERMS & CONDITIONS:\n• Please indicate the invoice number when making payment.';
  const inv = (extra: any = {}) =>
    renderDocumentHtml('INVOICE', data('INVOICE', effectiveDesign({ layout: 'wct', titleText: 'INVOICE' }, 'INVOICE', RK), { discountAmount: 200 }, { termsAndConditions: INV_TERMS, ...extra }), org)!;
  it('invoice: no GST Reg No, title INVOICE, Discount line, its terms with capital headings and no extra title', () => {
    const h = inv();
    expect(h).not.toContain('GST Reg No');
    expect(h).toContain('>INVOICE</div>');
    expect(h).not.toContain('TAX INVOICE');
    expect(h).toContain('Discount:</td><td class="v">$200.00</td>');
    expect(h).toContain('<div class="hd">PAYMENT METHOD:</div>');
    expect(h).toContain('<div class="hd">TERMS &amp; CONDITIONS:</div>');
    expect(h).not.toContain('Terms and Conditions:');
    expect(h.match(/TERMS &amp; CONDITIONS:/g)?.length).toBe(1);
    expect(h).not.toContain('class="rkwm"');
  });
  it('invoice terms without a heading get TERMS & CONDITIONS', () => {
    expect(inv({ termsAndConditions: '- Pay within 30 days' })).toContain('<div class="hd">TERMS &amp; CONDITIONS:</div><div class="bl"><span>-</span><span>Pay within 30 days</span></div>');
  });
  it('DO: no GST Reg No, WCT DO body', () => {
    const doH = renderDocumentHtml('DELIVERY_ORDER', data('DELIVERY_ORDER', effectiveDesign({ layout: 'wct' }, 'DELIVERY_ORDER', RK)), org)!;
    expect(doH).not.toContain('GST Reg No');
    expect(doH).toContain('Sold To:');
  });
  it('the round Racking logo prints larger in the letterhead', () => {
    expect(inv()).toMatch(/\.wct\.rk \.lh img \{ max-height: 86px; max-width: 120px; \}/);
  });
});

describe('Racking watermark (enableRackingWatermark)', () => {
  const WM = { ...RK, enableRackingWatermark: true };
  const q = (features: any) => renderDocumentHtml('QUOTATION', { ...data('QUOTATION', effectiveDesign(TPL, 'QUOTATION', features)), logoUrl: 'https://x/racking.png' }, org)!;
  it('the org logo, large, centred and pale behind the quotation', () => {
    const h = q(WM);
    expect(h).toContain('<div class="rkwm"><img src="https://x/racking.png" alt="" /></div><div class="wct rk">');
    expect(h).toMatch(/\.rkwm \{ position: fixed; top: 50%; left: 50%; transform: translate\(-50%, -50%\); width: 150mm; z-index: -1;/);
    expect(h).toMatch(/\.rkwm img \{ width: 100%; display: block; opacity: 0\.11; \}/);
  });
  it('none without the setting, without a logo, or without the Racking layout', () => {
    expect(q(RK)).not.toContain('class="rkwm"');
    expect(renderDocumentHtml('QUOTATION', data('QUOTATION', effectiveDesign(TPL, 'QUOTATION', WM)), org)).not.toContain('class="rkwm"');
    expect((effectiveDesign(TPL, 'QUOTATION', { enableRackingWatermark: true }) as any).watermark).toBeUndefined();
  });
});

describe('section titles without an S/No from snoSkipTitlesSince (WCT (S), BC Air, Racking)', () => {
  const SINCE = { snoSkipTitlesSince: '2026-11-18T12:00:00.000Z' };
  const nos = (h: string) => [...h.matchAll(/<td class="no">(\d*)<\/td>/g)].map((m) => m[1]);
  const render = (t: string, features: any, doc: any, tpl: any = TPL) => renderDocumentHtml(t, data(t, effectiveDesign(tpl, t, features, doc)), org)!;
  it('a document created at / after the date, or not saved yet: titles unnumbered, first item 1', () => {
    for (const doc of [{ createdAt: '2026-11-18T12:00:00.000Z' }, { createdAt: new Date('2026-12-01') }, { isNew: true }])
      for (const t of ['QUOTATION', 'INVOICE', 'DELIVERY_ORDER']) expect(nos(render(t, SINCE, doc))).toEqual(['1', '2', '3']);
  });
  it('BC Air branded invoice too', () => {
    expect(nos(render('INVOICE', { ...SINCE, wctDocumentBrand: 'BCAIR' }, { isNew: true }, null))).toEqual(['1', '2', '3']);
  });
  it('a document created before the date, or of unknown age, prints exactly as before', () => {
    for (const doc of [{ createdAt: '2026-11-18T11:59:59.999Z' }, { createdAt: null }, undefined, {}])
      for (const t of ['QUOTATION', 'INVOICE', 'DELIVERY_ORDER']) {
        const h = render(t, SINCE, doc);
        expect(h).toBe(render(t, {}, doc));
        expect(nos(h)).toEqual(['2', '3', '5']);
      }
  });
  it('imported documents and orgs without the setting never change; a bad date is ignored', () => {
    expect((effectiveDesign(TPL, 'INVOICE', SINCE, { imported: true, isNew: true }) as any).snoSkipTitles).toBeUndefined();
    for (const f of [{}, null, { snoSkipTitlesSince: 'soon' }, { snoSkipTitlesSince: true }]) expect((effectiveDesign(TPL, 'QUOTATION', f, { isNew: true }) as any).snoSkipTitles).toBeUndefined();
    expect((effectiveDesign(null, 'QUOTATION', SINCE, { isNew: true }) as any).snoSkipTitles).toBeUndefined();
  });
});

describe('every other org: byte-identical', () => {
  it('a WCT-layout quotation / invoice / DO without the flag renders exactly as the template design alone', () => {
    for (const t of ['QUOTATION', 'INVOICE', 'DELIVERY_ORDER']) {
      const a = renderDocumentHtml(t, data(t, effectiveDesign(TPL, t, { enableWctOrders: true })), org);
      const b = renderDocumentHtml(t, data(t, resolveDesign(TPL)), org);
      expect(a).toBe(b);
      expect(a).toContain('GST Reg No');
    }
  });
});
