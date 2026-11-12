import { renderWctBody } from './wct';
import { resolveDesign } from './design';

// WCT quotation (2026-11-04): an e-signature prints in the blank space above "Company Stamp & Authorized Signature",
// the signer and date in small type under it; an unsigned quotation keeps the plain block.
const SIG = 'data:image/png;base64,iVBORw0KGgo=';
const org = { name: 'WCT' };
const design = resolveDesign({ layout: 'wct' });
const quote = (config: any) => renderWctBody('quotation', { name: 'QO202611-0001', config, documentInfo: {}, items: [] }, org, design);

describe('WCT quotation signature block', () => {
  it('unsigned: plain label, no image', () => {
    const html = quote({});
    expect(html).toContain('<div class="closing">');
    expect(html).toContain('<div class="stamp">Company Stamp &amp; Authorized Signature</div>');
    expect(html).not.toContain('<img class="sigimg"');
    expect(html).toContain('<div class="r">Confirmation of Order</div>');
  });

  it('signed: image above the label, signer and date under it, nothing under Confirmation of Order', () => {
    const html = quote({ clientSignature: { image: SIG, name: 'Tan <Ah> Kow', signedAt: '2026-11-04T09:30:00+08:00' } });
    expect(html).toContain('<div class="closing signed">');
    expect(html).toMatch(/<div class="stamp"><img class="sigimg" src="data:image\/png;base64,iVBORw0KGgo=" alt="" \/>Company Stamp &amp; Authorized Signature<div class="who">Tan &lt;Ah&gt; Kow &nbsp;·&nbsp; 04\/11\/2026<\/div><\/div>/);
    expect(html).toContain('<div class="r">Confirmation of Order</div>');
    expect(html).not.toContain('Accepted by');
  });

  it('a signature that is not a png/jpeg data URL is ignored', () => {
    const html = quote({ clientSignature: { image: 'javascript:alert(1)', name: 'X' } });
    expect(html).not.toContain('<img class="sigimg"');
    expect(html).toContain('<div class="closing">');
  });

  it('invoices never print it', () => {
    const html = renderWctBody('invoice', { name: 'INV-1', config: { clientSignature: { image: SIG } }, documentInfo: {}, items: [] }, org, design);
    expect(html).not.toContain('<img class="sigimg"');
  });

  it('the signature line sits above the label, signed or not (2026-11-13)', () => {
    expect(quote({})).toMatch(/\.wct \.closing \.stamp \{[^}]*border-top: 1px solid #000/);
  });

  it('the signed date is the org\'s date, not the server\'s UTC (2026-11-13)', () => {
    // 23:30 UTC on 4 Nov is 5 Nov in Singapore.
    const late = quote({ clientSignature: { image: SIG, name: 'A', signedAt: '2026-11-04T23:30:00Z' } });
    expect(late).toContain('A &nbsp;·&nbsp; 05/11/2026');
    // A date stamped at signing (in the org's zone) wins.
    const stamped = quote({ clientSignature: { image: SIG, name: 'A', signedAt: '2026-11-04T23:30:00Z', signedDateText: '05/11/2026' } });
    expect(stamped).toContain('A &nbsp;·&nbsp; 05/11/2026');
  });
});
