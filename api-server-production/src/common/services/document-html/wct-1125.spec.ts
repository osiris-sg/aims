import { renderWctBody } from './wct';
import { resolveDesign } from './design';

const design = resolveDesign({ layout: 'wct' } as any);
const base = (extra: any = {}) => ({
  name: 'X-1',
  customer: { name: 'ACME', address: '10 Jurong West St 41 639273' },
  ...extra,
  documentInfo: { date: '2026-11-25', jobLocation: 'Site 1', ...(extra.documentInfo || {}) },
  items: [{ description: 'Line', quantity: 1, unitPrice: 10, amount: 10 }],
});
const SIG = 'data:image/png;base64,AAAA';

describe('WCT print 25 Nov: company stamp between "Yours Sincerely" and the signer line', () => {
  it('quotation: Yours Sincerely < stamp < Director of', () => {
    const h = renderWctBody('quotation', base({ documentInfo: { addCompanyStamp: true } }), { name: 'WCT (S) Systems Pte Ltd' }, design);
    const ys = h.indexOf('Yours Sincerely');
    const st = h.indexOf('class="cstamp"');
    const dir = h.indexOf('Director of WCT');
    expect(ys).toBeGreaterThan(0);
    expect(st).toBeGreaterThan(ys);
    expect(dir).toBeGreaterThan(st);
    expect(h).toContain('closing after-stamp');
  });
  it('quotation without the stamp keeps the old closing gap', () => {
    const h = renderWctBody('quotation', base(), {}, design);
    expect(h).not.toContain('class="cstamp"');
    expect(h).not.toContain('closing after-stamp');
  });
  it('invoice: the stamp follows "Yours Sincerely"', () => {
    const h = renderWctBody('invoice', base({ documentInfo: { addCompanyStamp: true } }), {}, design);
    expect(h.indexOf('class="cstamp"')).toBeGreaterThan(h.indexOf('Yours Sincerely'));
  });
  it('Racking quotation: between "Yours Sincerely," and the signer', () => {
    const d = resolveDesign({ layout: 'wct' } as any);
    (d as any).racking = true;
    const h = renderWctBody('quotation', base({ documentInfo: { addCompanyStamp: true, signedBy: 'Tan' } }), {}, d);
    expect(h.indexOf('class="cstamp"')).toBeGreaterThan(h.indexOf('Yours Sincerely,'));
    expect(h.indexOf('class="scr">Tan')).toBeGreaterThan(h.indexOf('class="cstamp"'));
  });
  it('DO: the stamp sits under the Remarks on the left', () => {
    const h = renderWctBody('do', base({ remarks: 'Hello', documentInfo: { addCompanyStamp: true } }), {}, design);
    const l = h.indexOf('<div class="dosign"><div class="l">');
    expect(l).toBeGreaterThan(0);
    expect(h.indexOf('Remarks:')).toBeGreaterThan(l);
    expect(h.indexOf('class="cstamp"')).toBeGreaterThan(h.indexOf('Remarks:'));
    expect(h.indexOf('<div class="r">', l)).toBeGreaterThan(h.indexOf('class="cstamp"'));
  });
});

describe('WCT print 25 Nov: DO signature bottom right, on the Remarks line', () => {
  const reports = [{ kind: 'DO_ACK', signature: SIG, signedByName: 'Mr Lee', signedDateText: '25/11/2026', signedAt: '2026-11-25T03:00:00Z' }];
  it('signed: image + name + date in the right column of the Remarks row', () => {
    const h = renderWctBody('do', base({ remarks: 'R1', maintenanceReports: reports }), {}, design);
    const row = h.slice(h.indexOf('<div class="dosign">'));
    expect(row.indexOf('Remarks:')).toBeLessThan(row.indexOf('<div class="r">'));
    expect(row).toContain(`<div class="r"><div class="sig"><img src="${SIG}"`);
    expect(row).toContain('Mr Lee &nbsp;·&nbsp; 25/11/2026');
    expect(h).not.toContain('Received by:');
  });
  it('the editor preview / stored PDF: the server-added signature (wctDoSignature), dated in Singapore', () => {
    const h = renderWctBody('do', base({ remarks: 'R1', wctDoSignature: { signature: SIG, signedByName: 'Lim', signedAt: '2026-11-24T17:30:00Z' } }), {}, design);
    expect(h).toContain(`<div class="r"><div class="sig"><img src="${SIG}"`);
    expect(h).toContain('Lim &nbsp;·&nbsp; 25/11/2026');
    expect(h).not.toContain('PROOF OF DELIVERY');
    // Not a png / jpeg data URL: ignored.
    expect(renderWctBody('do', base({ wctDoSignature: { signature: 'javascript:x' } }), {}, design)).not.toContain('class="sig"');
  });
  it('unsigned: the right column is blank', () => {
    const h = renderWctBody('do', base({ remarks: 'R1' }), {}, design);
    expect(h).toContain('<div class="r"></div>');
    expect(h).not.toContain('Name / Signature / Date');
  });
  it('signed with no remarks still prints the signature row', () => {
    const h = renderWctBody('do', base({ maintenanceReports: reports }), {}, design);
    expect(h).toContain('<div class="dosign"><div class="l"></div><div class="r"><div class="sig">');
  });
});

describe('WCT print 25 Nov: Subject from the quotation, PO Number', () => {
  it('DO prints its own Subject, else the quotation\'s (no Job Location box: Ship To is the site)', () => {
    const own = renderWctBody('do', base({ documentInfo: { subject: 'MV - Own' }, quotationSubject: 'AA+CD - Test Subject' }), {}, design);
    expect(own).toContain('<b>Subject:</b> MV - Own');
    expect(own).not.toContain('Test Subject');
    const fromQo = renderWctBody('do', base({ quotationSubject: 'AA+CD - Test Subject' }), {}, design);
    expect(fromQo).toContain('<b>Subject:</b> AA+CD - Test Subject');
    expect(fromQo).not.toContain('<b>Job Location:</b>');
    expect(renderWctBody('do', base(), {}, design)).not.toContain('<b>Subject:</b>');
  });
  it('invoice falls back to the quotation Subject too', () => {
    const h = renderWctBody('invoice', base({ quotationSubject: 'AA - Q' }), {}, design);
    expect(h).toContain('<b>Subject:</b> AA - Q');
  });
  it('invoice: PO Number row directly below Subject, only when filled', () => {
    const h = renderWctBody('invoice', base({ documentInfo: { subject: 'AA - S', poNumber: 'PO12333' } }), {}, design);
    const s = h.indexOf('<b>Subject:</b>');
    const p = h.indexOf('<div class="row"><b>PO Number:</b> PO12333</div>');
    expect(s).toBeGreaterThan(0);
    expect(p).toBeGreaterThan(s);
    expect(h.slice(s, p)).not.toContain('<div class="row">');
    expect(renderWctBody('invoice', base({ documentInfo: { subject: 'AA - S' } }), {}, design)).not.toContain('PO Number');
    expect(renderWctBody('invoice', base({ poNumber: 'PO-TOP' }), {}, design)).toContain('<b>PO Number:</b> PO-TOP');
  });
  it('the quotation never prints a PO Number row', () => {
    expect(renderWctBody('quotation', base({ documentInfo: { poNumber: 'PO1' } }), {}, design)).not.toContain('PO Number');
  });
});
