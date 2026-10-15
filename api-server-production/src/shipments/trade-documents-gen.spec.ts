import { DOC_FONT_FAMILY, japaneseFontCss } from './trade-doc-font';
import {
  addBusinessDays,
  amountOf,
  customsWeek,
  isJapanBusinessDay,
  helperRemarks,
  invoice1Line,
  invoice2Lines,
  invoiceHeaderDefaults,
  defaultLmeMonth,
  monthBefore,
  InvoiceLine,
  invoiceSubject,
  invoiceTotals,
  renderInvoiceHtml,
  roundDown,
  roundTo,
  unitPriceOf,
} from './trade-invoice';
import { packingFromBundles, packingTotals, renderSgjpHtml, renderSiHtml, sgjpAmount } from './trade-logistics-docs';

const line = (over: Partial<InvoiceLine>): InvoiceLine => ({ description: '', quantity: null, unit: 'トン', unitPrice: null, amountOverride: null, remarks: '', dueDate: null, ...over });
// The real ADH Invoice #1 (454003255 + 454003422).
const L6005 = line({ grade: '6005', quantity: 120, lme: 3458.64, qmjp: 351.5, premium: 190, upcharge: 10 });
const L6063 = line({ grade: '6063', quantity: 300, lme: 3458.64, qmjp: 351.5, premium: 230 });

describe('ADH 請求書 — pricing helper, totals, tax, JPY', () => {
  it('unit price = LME + QMJP + premium + upcharge; amount = qty × unit price', () => {
    expect(unitPriceOf(L6005)).toBe(4010.14);
    expect(amountOf(L6005)).toBe(481216.8);
    expect(unitPriceOf(L6063)).toBe(4040.14);
    expect(amountOf(L6063)).toBe(1212042);
  });
  it('reproduces the real invoice: subtotal / 10 % tax / total and the JPY breakdown at 161.67', () => {
    const t = invoiceTotals([L6005, L6063], 10, 161.67);
    expect(t).toMatchObject({ subtotal: 1693258.8, tax: 169325.88, total: 1862584.68 });
    expect(t.jpy).toEqual({ subtotal: 273749150, tax: 27374915, total: 301124065 });
  });
  it('税込み小計 per product only when more than one product is billed', () => {
    expect(invoiceTotals([L6005, L6063], 10, null).perProduct).toEqual([
      { label: '6005', net: 481216.8, tax: 48121.68, gross: 529338.48 },
      { label: '6063', net: 1212042, tax: 121204.2, gross: 1333246.2 },
    ]);
    expect(invoiceTotals([L6063], 10, null).perProduct).toEqual([]);
    expect(invoiceTotals([L6063], 10, null).jpy).toBeNull(); // no FX rate → no JPY row
  });
  it("negative lines (Invoice #2 adjustments / refunds) make negative totals; amounts and tax truncate toward zero like ADH's ROUNDDOWN", () => {
    // 40.775 × 3950.1 = 161,065.3275 → 161,065.32 (ROUNDDOWN); tax ROUNDDOWN(−2,471.39 × 10%) = −247.13.
    const t = invoiceTotals([line({ quantity: 40.775, unitPrice: 3950.1 }), line({ amountOverride: -164736.71 }), line({ quantity: 1, unitPrice: 1200 })], 10, 161.67);
    expect(t).toMatchObject({ subtotal: -2471.39, tax: -247.13, total: -2718.52 });
    expect(t.jpy).toEqual({ subtotal: -399550, tax: -39955, total: -439505 });
    expect(roundTo(-0.005, 2)).toBe(-0.01);
    expect(roundDown(-0.019, 2)).toBe(-0.01);
    expect(roundDown(1212042.0000000002, 2)).toBe(1212042);
  });
  it('typed unit price when no helper field is filled; an amount override wins', () => {
    expect(unitPriceOf(line({ unitPrice: 4000 }))).toBe(4000);
    expect(amountOf(line({ quantity: 2, unitPrice: 4000, amountOverride: 7999.995 }))).toBe(8000);
  });
  it('helper remarks text', () => {
    expect(helperRemarks(L6005, '2026-06')).toBe('LME Cash 2026/6月平均(3458.64USD) +351.5(QMJP) +190(Billet Premium) +10(Upcharge)');
    expect(helperRemarks(L6063, '2026-06')).toBe('LME Cash 2026/6月平均(3458.64USD) +351.5(QMJP) +230(Billet Premium)');
    expect(helperRemarks(line({ unitPrice: 1 }), '2026-06')).toBe('');
  });
});

describe('dates (Asia/Tokyo calendar days)', () => {
  it('due date = issue date + 7 business days, skipping weekends', () => {
    expect(addBusinessDays('2026-07-01', 7)).toBe('2026-07-10'); // Wed → Fri next week
    expect(addBusinessDays('2026-07-03', 1)).toBe('2026-07-06'); // Fri → Mon
    expect(addBusinessDays('2026-07-04', 7)).toBe('2026-07-14'); // Sat start
  });
  it('skips Japanese public holidays: issued Fri 2026/7/10 → due 7/22 (海の日 Mon 7/20 is not a business day)', () => {
    expect(isJapanBusinessDay('2026-07-20')).toBe(false);
    // 7/13, 14, 15, 16, 17, (20 holiday), 21, 22.
    expect(addBusinessDays('2026-07-10', 7)).toBe('2026-07-22');
  });
  it('Golden Week: 昭和の日 4/29 and 5/3–5/6 (振替休日) are skipped', () => {
    for (const d of ['2026-04-29', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06']) expect(isJapanBusinessDay(d)).toBe(false);
    expect(isJapanBusinessDay('2026-04-30')).toBe(true);
    expect(isJapanBusinessDay('2026-05-07')).toBe(true);
    // Tue 4/28 + 7: 4/30, 5/1, 5/7, 5/8, 5/11, 5/12, 5/13.
    expect(addBusinessDays('2026-04-28', 7)).toBe('2026-05-13');
    // 2027: 4/29 Thu, 5/3–5/5 Mon–Wed → 4/30, 5/6, 5/7.
    expect(addBusinessDays('2027-04-28', 3)).toBe('2027-05-07');
    // 2028: 5/3–5/5 Wed–Fri.
    expect(addBusinessDays('2028-05-02', 1)).toBe('2028-05-08');
  });
  it('New Year: 12/31, 1/1–1/3 and 成人の日 are skipped', () => {
    for (const d of ['2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-11']) expect(isJapanBusinessDay(d)).toBe(false);
    expect(isJapanBusinessDay('2026-12-30')).toBe(true);
    expect(isJapanBusinessDay('2027-01-04')).toBe(true);
    // Wed 12/30 + 1 → Mon 1/4; + 7 → 1/12 (Mon 1/11 is 成人の日).
    expect(addBusinessDays('2026-12-30', 1)).toBe('2027-01-04');
    expect(addBusinessDays('2026-12-30', 7)).toBe('2027-01-13');
    expect(addBusinessDays('2027-12-29', 2)).toBe('2028-01-04');
  });
  it('holidays hold in any server time zone (dates are calendar days)', () => {
    const tz = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      expect(isJapanBusinessDay('2026-05-04')).toBe(false);
      process.env.TZ = 'America/Los_Angeles';
      expect(isJapanBusinessDay('2026-05-04')).toBe(false);
      expect(isJapanBusinessDay('2026-05-07')).toBe(true);
    } finally {
      process.env.TZ = tz;
    }
  });
  it('customs FX week (Sun–Sat) for the note, as ADH prints it', () => {
    expect(customsWeek('2026-07-01')).toBe('6/28～7/4');
    expect(customsWeek('2026-07-10')).toBe('7/5～7/11');
  });
});

describe('prefills', () => {
  const defaults = {
    invoiceFromBlock: 'アジアディールハブジャパン合同会社\n〒107-0052 東京都港区赤坂二丁目14-5 Daiwa赤坂ビル7階',
    invoiceSubjectTemplate: '{grades}{product}品',
    productJa: { 'Aluminium Billet': 'アルミニウムビレット' },
    invoiceLineTemplate: 'Aluminium Billet - {grade} as per Specification of {size}\n{qty}MT +- {tol}% Tolerance',
  };
  it('header: today, registration no., customer, subject from grades, due date, FX note, LME month', () => {
    const h = invoiceHeaderDefaults({
      today: '2026-07-01',
      org: { name: 'ADH', registrationNumber: 'T7010403028176' },
      customerName: 'SUS Co., Ltd.',
      grades: ['6063', '6063'],
      products: ['Aluminium Billet'],
      defaults,
      lmeMonth: defaultLmeMonth('INVOICE_1', '2026-07'),
    });
    expect(h).toMatchObject({
      issueDate: '2026-07-01',
      registrationNo: 'T7010403028176',
      toName: 'SUS Co., Ltd.',
      toSuffix: '御中',
      subject: '6063アルミニウムビレット品',
      dueDate: '2026-07-10',
      taxRate: 10,
      fxNote: '円/USD 税関6/28～7/4 外国為替相場参照',
      lmeMonth: '2026-06',
      fromBlock: defaults.invoiceFromBlock,
    });
    // Never derived from today: no shipment month → blank (typed by the user).
    expect(invoiceHeaderDefaults({ today: '2026-07-01', org: { name: 'ADH' }, customerName: 'SUS', grades: [], products: [], defaults }).lmeMonth).toBe('');
  });
  it('LME month defaults from the shipment month: Invoice #1 = month before; Invoice #2 / SG→JP = the month', () => {
    expect(defaultLmeMonth('INVOICE_1', '2026-07')).toBe('2026-06');
    expect(defaultLmeMonth('INVOICE_1', '2026-01')).toBe('2025-12');
    expect(defaultLmeMonth('INVOICE_2', '2026-07')).toBe('2026-07');
    expect(defaultLmeMonth('SGJP_IV_PL', '2026-07')).toBe('2026-07');
    expect(defaultLmeMonth('INVOICE_1', null)).toBe('');
    expect(defaultLmeMonth('INVOICE_2', 'Jul 2026')).toBe('');
    expect(monthBefore('2026-03')).toBe('2026-02');
  });
  it('subject: {grade} gives one line per grade (ADH), {grades} joins them', () => {
    expect(invoiceSubject('{grade}{product}品', ['6005', '6063', '6005'], 'アルミニウムビレット')).toBe('6005アルミニウムビレット品\n6063アルミニウムビレット品');
    expect(invoiceSubject('{grades}{product}品', ['6005', '6063'], 'アルミニウムビレット')).toBe('6005・6063アルミニウムビレット品');
    expect(invoiceSubject(undefined, ['6063'], 'アルミニウムビレット')).toBe('6063アルミニウムビレット');
  });
  it('Invoice #1 line from a contract line', () => {
    const l = invoice1Line(
      { id: 'c1', contractNo: '454003422' },
      { id: 'L1', grade: '6063', product: 'Aluminium Billet', sizeSpec: '203 MM (8 INCH)', quantityMt: '300.000', tolerancePct: '5.00' },
      defaults,
      '2026-07-10',
    );
    expect(l).toMatchObject({
      description: 'Aluminium Billet - 6063 as per Specification of 203 MM (8 INCH)\n300MT +- 5% Tolerance',
      quantity: 300,
      contractId: 'c1',
      contractLineId: 'L1',
      grade: '6063',
      dueDate: '2026-07-10',
    });
  });
  it('Invoice #2: final price on net weight, minus what Invoice #1 billed, an empty cost line', () => {
    const rows = invoice2Lines({
      netWeightMt: '40.775',
      line: { id: 'L1', grade: '6063', product: 'Aluminium Billet', sizeSpec: '203 MM X 5800 MM', quantityMt: 300, tolerancePct: 5 },
      contract: { id: 'c1', contractNo: '454003422' },
      invoice1: { number: 'ADH-INV-2026-0001', quantity: 300, unitPrice: 4040.14, amount: 1212042 },
      defaults: {},
      dueDate: '2026-08-10',
    });
    expect(rows.map((r) => [r.description, r.quantity, amountOf(r)])).toEqual([
      ['Final price - 6063 203 MM X 5800 MM', 40.775, 0],
      ['Less: Invoice #1 (ADH-INV-2026-0001)', -300, -1212042],
      ['', null, 0],
    ]);
  });
});

describe('Japanese font + layout', () => {
  it('embeds only the Noto Sans JP chunks the text needs, as data: URIs', () => {
    const css = japaneseFontCss('請求書');
    expect(css).toContain(`font-family:'${DOC_FONT_FAMILY}'`);
    expect(css).toContain('data:font/woff2;base64,');
    expect(css.length).toBeLessThan(japaneseFontCss('請求書 アジアディールハブジャパン合同会社 東京都港区赤坂').length + 1);
    expect(japaneseFontCss('')).toBe('');
  });
  it('the 請求書 HTML carries the font and the numbers, and no DRAFT watermark even as a draft', () => {
    const h = { ...invoiceHeaderDefaults({ today: '2026-07-01', org: { name: 'ADH' }, customerName: 'SUS', grades: ['6005', '6063'], products: [], defaults: {} }), fxRate: 161.67 };
    const html = renderInvoiceHtml(h, [L6005, L6063], { draft: true });
    expect(html).toContain('@font-face');
    expect(html).toContain('Noto Sans JP');
    expect(html).toContain('>請求書</div>');
    expect(html).toContain('US$1,862,584.68');
    expect(html).toContain('¥301,124,065');
    expect(html).not.toContain('class="wm"');
    expect(renderInvoiceHtml(h, [L6005], { draft: false })).not.toContain('class="wm"');
  });
  it('SG→JP: amount = net × price; packing rows grouped per container; Shipping Instructions totals', () => {
    expect(sgjpAmount({ netWeightMt: 40.775, unitPrice: 4031.95 })).toBe(164402.76);
    const p = packingFromBundles([
      { container: 'WHLU0636631', netMt: 2.549, grossMt: 2.559 },
      { container: 'WHLU0636631', netMt: 2.548, grossMt: 2.558 },
      { container: 'WHSU2963217', netMt: 2.55, grossMt: 2.56 },
    ]);
    expect(p).toEqual([
      { containerNo: 'WHLU0636631', bundles: 2, netMt: 5.097, grossMt: 5.117 },
      { containerNo: 'WHSU2963217', bundles: 1, netMt: 2.55, grossMt: 2.56 },
    ]);
    expect(packingTotals(p)).toEqual({ containers: 2, bundles: 3, netMt: 7.647, grossMt: 7.677 });
    const sgjp = renderSgjpHtml(
      {
        invoiceNo: null,
        invoiceDate: '2026-07-22',
        sellerBlock: 'Asia Deal Hub Pte. Ltd.',
        buyerBlock: 'ADH JAPAN',
        blNumber: 'BL1',
        vessel: '',
        voyageNo: '',
        portOfLoading: '',
        portOfDischarge: '',
        terms: 'CIF YOKOHAMA',
        description: 'BILLET',
        hsCode: '',
        countryOfOrigin: '',
        netWeightMt: 40.775,
        grossWeightMt: null,
        bundles: 16,
        pieces: 80,
        unitPrice: 4031.95,
        currency: 'USD',
        remarks: '',
      },
      p,
    );
    expect(sgjp).toContain('PACKING LIST');
    expect(sgjp).toContain('USD 164,402.76');
    const si = renderSiHtml(
      {
        title: '出荷指示書 / SHIPPING INSTRUCTIONS',
        number: null,
        date: '2026-08-01',
        to: 'Mitsui Soko Co., Ltd.',
        fromBlock: 'ADH',
        contactName: '',
        blNumber: 'BL1',
        vessel: '',
        voyageNo: '',
        eta: null,
        containerCount: 2,
        telexReleaseCode: '',
        cargoDescription: '',
        netWeightMt: null,
        grossWeightMt: null,
        bundles: null,
        pieces: null,
        deliveryAddress: '',
        specialInstructions: '',
      },
      [
        { date: '08-07', trucks: 2, mt: 20.388, notes: '' },
        { date: '08-08', trucks: 2, mt: 20.387, notes: '' },
      ],
    );
    expect(si).toContain('40.775');
    expect(si).toContain('入港予定日');
  });
});
