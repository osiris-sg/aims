/**
 * ADH's real documents, field by field: Invoice #1 / #2 (請求書), the SG→JP
 * INVOICE & PACKING LIST, 計量検収票, 納品書兼分析試験成績報告書 and
 * 出庫・納入依頼書 — maths, prefills and the printed labels. Figures are ADH's
 * own (請求書正式ビレット 1回目 / 2回目, INVOICE & PACKING LIST 6063); batch
 * and cast numbers are made up.
 */
import { BadRequestException } from '@nestjs/common';
import { buildCustomerCoaJp, CoaFormatError, parseCoaPdfText } from './trade-coa';
import { mergeDocDefaults } from './trade-config.service';
import { customerDocHeader, deliveryProfileFor, deliveryRemarks, sgjpGoods } from './trade-generated.service';
import { buildDefaultHeader } from './trade-generated.service';
import { renderGeneratedHtml } from './trade-generated.html';
import { banksOf, defaultBank, DocDefaults, helperRemarks, invoice2FinalLines, invoiceHeaderDefaults, InvoiceLine, invoiceTotals, quarterOf, renderInvoiceHtml } from './trade-invoice';
import { billetSize, blTail, renderSgjpV2Html, renderSiV2Html, SgjpHeaderV2, SgjpItem, sgjpInvoiceNo, sgjpItemAmount, sgjpTotals, sgjpUnitPrice, SiHeaderV2 } from './trade-logistics-docs';
import { parseDelimitedSheet } from './trade-sheet.parser';

const line = (over: Partial<InvoiceLine>): InvoiceLine => ({ description: '', quantity: null, unit: 'トン', unitPrice: null, amountOverride: null, remarks: '', dueDate: null, ...over });
const strip = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

/** ADH's templates as set up by scripts/setup-adh-org.ts. */
const ADH: DocDefaults = {
  invoiceRemarksTemplate: 'LME Cash {month}月平均({LME}USD) +{QMJP}({q}QMJP) +{premium}(Billet Premium){upcharge}\n\nTotal Premium is {QMJP}({q}QMJP) + {totalPremium}',
  invoiceUpchargeTemplate: ' +{upcharge}(upcharge for {grade})',
  invoice2RemarksTemplate: 'LME Cash月平均　{month}月USD{LME} + {QMJP}({q}QMJP) +{premium}(Billet Premium){upcharge}\nTotal Premium is {QMJP}(QMJP) + {totalPremium}',
  invoice2LineTemplate: 'Aluminium Billet - {grade} as per Specification of 8 Inch-\n{qty}MT +- {tol}% Tolerance\n製品仕様は貴社指定仕様',
  invoice2OtherPerMt: 40,
  invoice2OtherRemarks: '{rate}USD/ton\n（{qty}トン/月)',
  banks: [
    { id: 'dbs', label: 'DBS Bank Ltd', block: 'DBS Bank Ltd\nBank SWIFT/BIC\tDBSSSGSG' },
    { id: 'cfsb', label: 'Community Federal Savings Bank', block: 'Community Federal Savings Bank\nRouting number\t026073150' },
  ],
  defaultBankId: 'dbs',
  sizeInch: { '203': '8 inch', '162': '6 inch' },
};

describe('請求書 remarks (備考) — price build-up as ADH prints it', () => {
  it('quarter of the LME month labels QMJP (June → 2QMJP, July → 3QMJP)', () => {
    expect(quarterOf('2026-06')).toBe('2');
    expect(quarterOf('2026-07')).toBe('3');
    expect(quarterOf('')).toBe('');
  });
  it('Invoice #1: upcharge named with the grade, then "Total Premium is …"', () => {
    const l6005 = line({ grade: '6005', lme: 3458.64, qmjp: 351.5, premium: 190, upcharge: 10 });
    expect(helperRemarks(l6005, '2026-06', ADH.invoiceRemarksTemplate, ADH.invoiceUpchargeTemplate)).toBe(
      'LME Cash 2026/6月平均(3458.64USD) +351.5(2QMJP) +190(Billet Premium) +10(upcharge for 6005)\n\nTotal Premium is 351.5(2QMJP) + 200',
    );
    const l6063 = line({ grade: '6063', lme: 3458.64, qmjp: 351.5, premium: 230 });
    expect(helperRemarks(l6063, '2026-06', ADH.invoiceRemarksTemplate, ADH.invoiceUpchargeTemplate)).toBe(
      'LME Cash 2026/6月平均(3458.64USD) +351.5(2QMJP) +230(Billet Premium)\n\nTotal Premium is 351.5(2QMJP) + 230',
    );
  });
  it('Invoice #2: the shipment-month LME line', () => {
    const l = line({ grade: '6063', lme: 3155.98, qmjp: 395, premium: 230 });
    expect(helperRemarks(l, '2026-07', ADH.invoice2RemarksTemplate, ADH.invoiceUpchargeTemplate)).toBe(
      'LME Cash月平均　2026/7月USD3155.98 + 395(3QMJP) +230(Billet Premium)\nTotal Premium is 395(QMJP) + 230',
    );
  });
});

describe('請求書 — banks, seal', () => {
  it('banks: the list wins over the legacy single block; the default is preselected', () => {
    expect(banksOf(ADH).map((b) => b.id)).toEqual(['dbs', 'cfsb']);
    expect(defaultBank({ ...ADH, defaultBankId: 'cfsb' })?.id).toBe('cfsb');
    expect(banksOf({ invoiceBankBlock: 'Old Bank\nSWIFT\tX' })).toEqual([{ id: 'default', label: 'Old Bank', block: 'Old Bank\nSWIFT\tX' }]);
    const h = invoiceHeaderDefaults({ today: '2026-07-10', org: { name: 'ADH' }, customerName: 'SUS株式会社', grades: ['6005'], products: ['Aluminium Billet'], defaults: ADH });
    expect(h).toMatchObject({ bankId: 'dbs', bankBlock: ADH.banks![0].block, showSeal: true });
  });
  it('the seal prints beside the From block only for an image data: URL, and can be turned off', () => {
    const h = invoiceHeaderDefaults({ today: '2026-07-10', org: { name: 'ADH' }, customerName: 'SUS', grades: ['6005'], products: ['Aluminium Billet'], defaults: ADH });
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(renderInvoiceHtml(h, [], { seal: png })).toContain(`<img class="seal" src="${png}"`);
    expect(renderInvoiceHtml({ ...h, showSeal: false }, [], { seal: png })).not.toContain('class="seal"');
    expect(renderInvoiceHtml(h, [], { seal: 'javascript:alert(1)' })).not.toContain('class="seal"');
  });
});

describe('Invoice #2 (2回目) — ADH 6063 305.804 t', () => {
  const rows = [
    line({ grade: '6063', quantity: 305.804, lme: 3155.98, qmjp: 395, premium: 230 }),
    line({ quantity: 1, unitPrice: 16754.03 }), // 通関、車輸送料 — 課税対象
    line({ quantity: 1, unitPrice: 74.21, taxable: false }), // 通関 — 課税対象外
    line({ quantity: 305.804, unitPrice: 40 }), // 他諸掛
  ];
  it('課税対象金額 / 消費税(10%) / 課税以外金額 / 合計 and the JPY row at 159', () => {
    const t = invoiceTotals(rows, 10, 159);
    expect(t).toMatchObject({ taxable: 1185224.99, tax: 118522.49, nonTaxable: 74.21, total: 1303821.69 });
    expect(t.jpy).toEqual({ subtotal: 188450773, tax: 18845077, total: 207295850 });
  });
  it("prints ADH's six total rows; 合計(税込) and ２回目の金額 are the 差額 against Invoice #1 (negative here)", () => {
    const h = {
      ...invoiceHeaderDefaults({ today: '2026-10-05', org: { name: 'ADH' }, customerName: 'SUS株式会社', grades: ['6063'], products: ['Aluminium Billet'], defaults: ADH }),
      fxRate: 159,
      variant: 'final' as const,
      invoice1Amount: 1333246.2,
    };
    const text = strip(renderInvoiceHtml(h, rows));
    for (const s of [
      '課税対象金額 1,185,224.99',
      '消費税(10%) 118,522.49',
      '課税以外金額 74.21',
      '合計 1,303,821.69',
      '１回目の金額 1,333,246.20',
      '２回目の金額(差額) -29,424.51',
      '合計(税込) US$-29,424.51',
      'US$1,185,224.99 US$118,522.49 US$1,303,747.48',
      '¥188,450,773 ¥18,845,077 ¥207,295,850',
    ])
      expect(text).toContain(s);
  });
  it('prefill: final price on the net weight (helper from Invoice #1), taxable customs, non-taxable 通関, 他諸掛 40 USD/MT', () => {
    const lines = invoice2FinalLines({
      netWeightMt: '305.804',
      line: { id: 'l1', grade: '6063', product: 'Aluminium Billet', sizeSpec: '203 MM X 5800 MM', quantityMt: '300', tolerancePct: '5' },
      contract: { id: 'c1', contractNo: '454003422' },
      invoice1Line: { qmjp: 351.5, premium: 230, upcharge: null },
      defaults: ADH,
      dueDate: '2026-10-13',
      lmeMonth: '2026-07',
    });
    expect(lines.map((l) => [l.quantity, l.taxable])).toEqual([
      [305.804, true],
      [1, true],
      [1, false],
      [305.804, true],
    ]);
    expect(lines[0].description).toBe('Aluminium Billet - 6063 as per Specification of 8 Inch-\n300MT +- 5% Tolerance\n製品仕様は貴社指定仕様');
    expect(lines[0]).toMatchObject({ qmjp: 351.5, premium: 230, lme: null, autoRemarks: true });
    expect(lines[3]).toMatchObject({ unitPrice: 40, remarks: '40USD/ton\n（305.804トン/月)' });
    expect(lines[2].description).toContain('課税対象外');
  });
});

describe('SG→JP INVOICE & PACKING LIST (ADH layout)', () => {
  const h: SgjpHeaderV2 = {
    layout: 2,
    invoiceNo: sgjpInvoiceNo('2026-08-20'),
    invoiceDate: '2026-08-20',
    shipperBlock: 'VEDANTA LIMITED (SEZ UNIT)\nJHARSUGUDA, ODISHA-768202, INDIA',
    consigneeBlock: 'ASIA DEAL HUB JAPAN LLC.',
    sellerBlock: 'ASIA DEAL HUB PTE. LTD.',
    buyerBlock: 'ASIA DEAL HUB JAPAN LLC.',
    placeOfReceipt: 'VISAKHAPATNAM PORT, INDIA',
    portOfLoading: 'VISAKHAPATNAM PORT, INDIA',
    portOfDischarge: 'Yokohama, JAPAN',
    placeOfDelivery: 'Yokohama, JAPAN',
    payment: '',
    countryOfOrigin: 'INDIA',
    vessel: 'RACHA BHUM / 211E',
    others: '',
    shippingMarks: '',
    signBlock: 'ASIA DEAL HUB PTE. LTD.\nSINGAPORE, 018982',
    currency: 'USD',
    lmeMonth: '2026-07',
  };
  const item: SgjpItem = {
    goods: 'Aluminium Billet Alloy 6063-8 inch',
    hsCode: '7601.20',
    terms: 'CIF',
    lme: 3155.98,
    qmjp: 395,
    premium: 230,
    upcharge: null,
    unitPrice: null,
    quantity: 305.804,
    bundles: 120,
    pieces: 600,
    netMt: 305.804,
    grossMt: 307.004,
    dimension: '5800mm length, \n8 inch diameter',
  };
  it('invoice no. ADH + yyyymmdd; customer price = LME + QMJP + premium + upcharge; amount ROUNDDOWN', () => {
    expect(h.invoiceNo).toBe('ADH20260820');
    expect(sgjpUnitPrice(item)).toBe(3780.98);
    expect(sgjpItemAmount(item)).toBe(1156238.8);
    // Without LME the typed unit price is used (helper fields are only a start).
    expect(sgjpUnitPrice({ ...item, lme: null, unitPrice: 3750.98 })).toBe(3750.98);
  });
  it("goods text from product, grade and the size's inch label", () => {
    expect(sgjpGoods('Aluminium Billet', '6063', '203 MM X 5800 MM', ADH)).toBe('Aluminium Billet Alloy 6063-8 inch');
    expect(sgjpGoods('Aluminium Billet 6063', '6063', '999 MM', ADH)).toBe('Aluminium Billet Alloy 6063 999 MM');
  });
  it("prints ADH's labels, both tables and the totals", () => {
    const text = strip(renderSgjpV2Html(h, [item]));
    for (const s of [
      'INVOICE & PACKING LIST',
      'INVOICE NO.: ADH20260820',
      'Invoice Date：2026/8/20',
      '（Shipper)',
      '(Consignee: Ship To)',
      '（Seller)',
      '(Buyer)',
      '(Place Of receipt)',
      '(Payment)',
      '(Shipping Marks)',
      '(Country Of Origin)',
      '(Vessel) RACHA BHUM / 211E',
      'C/No. DESCRIPTION UNIT PRICE QUANTITY TOTAL PRICE',
      'Aluminium Billet Alloy 6063-8 inch HS Code: 7601.20 CIF 3,780.98 305.804 1,156,238.80',
      'TOTAL 305.804 1,156,238.80',
      'PACKING DETAILS',
      "Q'TY Net Weight(MT) Gross Weight(MT) Dimention",
      'Aluminium Billet Alloy 6063-8 inch- 120 Bundles HS Code: 7601.20 600 PCS 305.804 307.004 5800mm length, 8 inch diameter',
      'TOTAL : 120 Bundle only 305.804 307.004',
    ])
      expect(text).toContain(s);
  });
  it('split arrivals: each document totals its own items', () => {
    const t = sgjpTotals([{ ...item, quantity: 96.908, netMt: 96.908, grossMt: 97.3, bundles: 38, pieces: 190 }]);
    expect(t).toMatchObject({ quantity: 96.908, bundles: 38, pieces: 190 });
  });
});

describe('出庫・納入依頼書 (ADH layout)', () => {
  it('B/L tail, billet size, delivery profile → 納入先 + 備考', () => {
    expect(blTail('198GX04630')).toBe('末尾・・・04630');
    expect(blTail('123')).toBe('123');
    expect(billetSize('203 MM X 5800 MM')).toBe('203 X 5800');
    expect(billetSize('203MM×5800MM')).toBe('203 X 5800');
    const profiles = [{ id: 'p1', customerName: 'SUS', siteName: 'SUS福島工場', address: '福島県須賀川市虹の台21-1', notes: 'AM7:30より作業開始\nバンド切れ外れはリバンドル\n' }];
    const p = deliveryProfileFor(profiles, 'SUS Co., Ltd.');
    expect(p?.siteName).toBe('SUS福島工場');
    expect(deliveryProfileFor(profiles, 'Other KK')).toBeNull();
    expect(deliveryRemarks(p!)).toBe('指定荷卸し場→　SUS福島工場　福島県須賀川市虹の台21-1\nAM7:30より作業開始\nバンド切れ外れはリバンドル');
  });
  it('prints the request, vessel / voyage / B/L tail / warehouse, one row per truck day, the merged weight cell and 備考', () => {
    const h: SiHeaderV2 = {
      layout: 2,
      requestDate: '2026-09-01',
      toName: '三井倉庫 株式会社',
      issuerName: 'アジアディールハブジャパン合同会社',
      title: '出庫・納入依頼書',
      vessel: 'RACHA BHUM',
      voyageNo: '211E',
      blNumber: '198GX04630',
      warehouseName: '三井倉庫/本牧A倉庫',
      grossWeightMt: 307.004,
      netWeightMt: 305.804,
      shipper: 'アジアディールハブジャパン合同会社',
      carrier: '三井倉庫手配便',
      remarks: '指定荷卸し場→　SUS福島工場　福島県須賀川市虹の台21-1\nトラック荷台左右に積載（真ん中はNG）',
    };
    const html = renderSiV2Html(h, [
      { shipDate: '2026-09-07', deliveryDate: '2026-09-08', destination: 'SUS福島工場', billet: 'ロングビレット203 X 5800', bundles: 16 },
      { shipDate: '2026-09-16', deliveryDate: '2026-09-17', destination: 'SUS福島工場', billet: 'ロングビレット203 X 5800', bundles: 8 },
    ]);
    const text = strip(html);
    for (const s of [
      '手配依頼日 2026年9月1日',
      '三井倉庫 株式会社 御中',
      '出庫・納入依頼書',
      '本船 RACHA BHUM',
      '海事№ 211E',
      'B/L № 末尾・・・04630',
      '倉庫名 三井倉庫/本牧A倉庫',
      '出荷日 納入日 納入先 ビレット 束 数 重 量',
      '9/7 9/8 SUS福島工場 ロングビレット 203 X 5800 16 総重量 307.004トン (正味重量 305.804トン)',
      '出 荷 主 アジアディールハブジャパン合同会社',
      '運送会社 三井倉庫手配便',
      '備 考 ・ 指定荷卸し場→ SUS福島工場 福島県須賀川市虹の台21-1 トラック荷台左右に積載（真ん中はNG）',
    ])
      expect(text).toContain(s);
    expect(html).toContain('rowspan="2"');
  });
});

describe("Customer COA (納品書兼分析試験成績報告書) from Vedanta's COA", () => {
  const perBundle = [
    'Batch\tCast No\tMaterial\tNet Wt\tGross WT\tLength\tSize\tFE\tSI\tTI\tMN\tMG\tZN\tPB\tCU\tCR\tAL\tOTTOT\tSR\tULT\tZR\tCD\t',
    'TA100101\tTA1001\tB60630108 \t2.548\t2.558 \t5800 \t8" \t0.1500 \t0.4600 \t0.0170 \t0.0270 \t0.4810 \t0.0050 \t0.0010 \t0.0005 \t0.0010 \t98.830 \t0.0300 \t \t \t0.0080 \t \t',
    'TA100102\tTA1001\tB60630108 \t2.550\t2.560 \t5800 \t8" \t0.1700 \t0.4600 \t0.0170 \t0.0270 \t0.4810 \t0.0050 \t0.0010 \t0.0005 \t0.0010 \t98.850 \t0.0300 \t \t \t0.0080 \t \t',
    'TB200201\tTB2002\tB60630108 \t2.549\t2.559 \t5800 \t8" \t0.1500 \t0.4600 \t0.0130 \t0.0240 \t0.4780 \t0.0059 \t0.0009 \t0.0013 \t0.0012 \t98.840 \t0.0300 \t \t \t0.0090 \t \t',
  ].join('\r\n');
  it('per-bundle COA.XLS → one row per cast: chemistry averaged (4 dp), bundles counted, net summed', () => {
    const r = buildCustomerCoaJp(parseDelimitedSheet(perBundle));
    expect(r.rows).toEqual([
      {
        batch: 'TA1001',
        fe: '0.1600',
        si: '0.4600',
        ti: '0.0170',
        mn: '0.0270',
        mg: '0.4810',
        zn: '0.0050',
        pb: '0.0010',
        cu: '0.0005',
        cr: '0.0010',
        al: '98.8400',
        ottot: '0.0300',
        zr: '0.0080',
        bundles: 2,
        netwt: 5.098,
      },
      {
        batch: 'TB2002',
        fe: '0.1500',
        si: '0.4600',
        ti: '0.0130',
        mn: '0.0240',
        mg: '0.4780',
        zn: '0.0059',
        pb: '0.0009',
        cu: '0.0013',
        cr: '0.0012',
        al: '98.8400',
        ottot: '0.0300',
        zr: '0.0090',
        bundles: 1,
        netwt: 2.549,
      },
    ]);
    expect(r.totals).toEqual({ bundles: 3, netMt: 7.647, pieces: null });
    expect(r.columns.map((c) => c.label).slice(0, 13)).toEqual(['Batch', 'FE', 'SI', 'TI', 'MN', 'MG', 'ZN', 'PB', 'CU', 'CR', 'AL', 'OTTOT', 'ZR']);
  });
  it('COA summary PDF text (cast rows with Bundle / PIECES) and the official COA PDF text (per bundle, "Other Total", no ZR)', () => {
    const summary = parseCoaPdfText(
      [
        'Date ： 04/08/2026',
        'Invoice Number ： XP0000000001',
        'Cast No Material Net WT Gross WT Bundle PIECES Length Size FE SI TI MN MG ZN PB CU CR AL OTTOT ZR',
        'TA1001 B60050108 33.169 33.299 13 65 5800 8" 0.1800 0.6600 0.0180 0.1290 0.4850 0.0052 0.0008 0.0232 0.0016 98.4800 0.0300 0.0090',
        'TB2002 B60050108 7.655 7.685 3 15 5800 8" 0.1700 0.6600 0.0150 0.1330 0.4920 0.0045 0.0008 0.0110 0.0052 98.4800 0.0300 0.0090',
        '40.824 40.984 16 80',
      ].join('\n'),
    );
    expect(summary).toMatchObject({ date: '2026-08-04', invoiceNo: 'XP0000000001' });
    const s = buildCustomerCoaJp(summary);
    expect(s.totals).toEqual({ bundles: 16, netMt: 40.824, pieces: 80 });
    expect(s.rows[0]).toMatchObject({ batch: 'TA1001', bundles: 13, netwt: 33.169, fe: '0.1800', zr: '0.0090' });

    const official = parseCoaPdfText(
      [
        'Cast No Sample Receiving date Sample analysis date',
        'TA1001 Jul 4, 2026 Jul 4, 2026',
        'Batch No Cast No. Material Net Wt. Gross Wt. Length Size Fe Si Ti Mn Mg Zn Cu Cr Pb Al Other Total',
        'TA100101 TA1001 B60630108 2.548 2.558 5800 8" 0.1500 0.4600 0.0170 0.0270 0.4810 0.0050 0.0005 0.0010 0.0010 98.830 0.0300',
        'TA100102 TA1001 B60630108 2.550 2.560 5800 8" 0.1700 0.4600 0.0170 0.0270 0.4810 0.0050 0.0005 0.0010 0.0010 98.850 0.0300',
      ].join('\n'),
    );
    const o = buildCustomerCoaJp(official);
    expect(o.rows).toEqual([expect.objectContaining({ batch: 'TA1001', bundles: 2, netwt: 5.098, fe: '0.1600', ottot: '0.0300', zr: null })]);
    expect(o.notes.join(' ')).toContain('ZR');
    expect(() => parseCoaPdfText('INVOICE\nTotal 1,000')).toThrow(CoaFormatError);
  });
  it('prints 様式, 品種 (BD, 1BD本数, トータル本数 PCS, 合計 weight), 日付 / ベンダー and the analysis table', () => {
    const r = buildCustomerCoaJp(parseDelimitedSheet(perBundle));
    const base = buildDefaultHeader(
      { name: 'Asia Deal Hub Japan LLC', address: null, phoneNumber: null, registrationNumber: null },
      {
        blNumber: null,
        vessel: null,
        voyageNo: null,
        portOfLoading: null,
        portOfDischarge: 'Yokohama, Japan',
        commodity: null,
        sizeSpec: '203 MM X 5800 MM',
        hsCode: '7601.20',
        countryOfOrigin: 'India',
        ciNumber: 'XP1',
        totalPieces: 15,
        customer: { name: '加藤軽金属工業株式会社', address: '愛知県海部郡蟹江町' },
        contract: { contractNo: 'C1', piNumber: null },
        contractLine: { grade: '6005', product: 'Aluminium Billet', sizeSpec: '203 MM X 5800 MM' },
      },
      '納品書兼分析試験成績報告書',
      'CUSTOMER_COA',
      '2025-08-18',
    );
    const d: DocDefaults = {
      customerDocIssuerName: 'アジアディールハブ合同会社',
      customerDocIssuerAddress: '東京都港区赤坂二丁目14-5\nDaiwa赤坂ビル7階',
      customerDocContact: '竹腰 俊朗',
      customerCoaFormLabel: '様式 1',
      customerCoaVendor: 'VEDANTA LIMITED',
      customerCoaPiecesPerBundle: 5,
    };
    const h = {
      ...customerDocHeader(base, { sizeSpec: '203 MM X 5800 MM', contractLine: { grade: '6005', product: 'Aluminium Billet', sizeSpec: null } }, 'CUSTOMER_COA', d),
      analysisDate: '2026-07-13',
    };
    expect(h).toMatchObject({ layout: 'jp', formLabel: '様式 1', productLine: 'ALUMINIUM BILLET 6005', sizeLine: '203MM × 5800MM', piecesPerBundle: 5, vendor: 'VEDANTA LIMITED' });
    const text = strip(renderGeneratedHtml('CUSTOMER_COA', h, r.columns, r.rows));
    for (const s of [
      '様式 1 2025/8/18',
      '納品書兼分析試験成績報告書',
      '加藤軽金属工業株式会社 御中',
      'アジアディールハブ合同会社 東京都港区赤坂二丁目14-5 Daiwa赤坂ビル7階 担当：竹腰 俊朗',
      '品種 ALUMINIUM BILLET 6005 203MM × 5800MM',
      'バンドル数 1BD本数 トータル本数 3 BD 5 15 PCS',
      '合計 3 BD 7.647 MT',
      '分析試験成績 日付： 2026/7/13 ベンダー：VEDANTA LIMITED',
      'Batch FE SI TI MN MG ZN PB CU CR AL OTTOT ZR',
      'TA1001 0.1600 0.4600',
    ])
      expect(text).toContain(s);
    expect(text).not.toContain('Bundles'); // bundles / net feed 品種, not the analysis table
  });
});

describe('Customer PL (計量検収票)', () => {
  it('header from the shipment + Vedanta PL fields, table per container with Sub Total and TOTAL', () => {
    const base = buildDefaultHeader(
      { name: 'Asia Deal Hub Japan LLC', address: null, phoneNumber: null, registrationNumber: null },
      {
        blNumber: 'BL1',
        vessel: null,
        voyageNo: null,
        portOfLoading: null,
        portOfDischarge: 'Nagoya, Japan',
        commodity: null,
        sizeSpec: '203 MM X 5800 MM',
        hsCode: '7601.20',
        countryOfOrigin: 'India',
        ciNumber: 'XP2652101585',
        totalPieces: null,
        customer: { name: '加藤軽金属工業株式会社', address: '愛知県海部郡蟹江町' },
        contract: { contractNo: 'C1', piNumber: null },
        contractLine: { grade: '6005', product: 'Aluminium Billet', sizeSpec: null },
      },
      '計量検収票',
      'CUSTOMER_PL',
      '2025-08-18',
    );
    const h = {
      ...customerDocHeader(
        base,
        {
          ciNumber: 'XP2652101585',
          portOfDischarge: 'Nagoya, Japan',
          hsCode: '7601.20',
          countryOfOrigin: 'India',
          sizeSpec: '203 MM X 5800 MM',
          contractLine: { grade: '6005', product: 'Aluminium Billet', sizeSpec: null },
        },
        'CUSTOMER_PL',
        { customerPlFormLabel: '様式2', customerPlApplicant: 'ASIA DEAL HUB PTE. LTD.', customerDocIssuerName: 'アジアディールハブ合同会社', customerDocContact: '竹腰 俊朗' },
      ),
      plDate: '2026-08-12',
    };
    expect(h).toMatchObject({
      formLabel: '様式2',
      invoiceNo: 'XP2652101585',
      portOfDischarge: 'NAGOYA, JAPAN',
      goodsDescription: 'ALUMINIUM BILLET ALLOY 6005 203 MM X 5800 MM',
      origin: 'INDIA',
      hsCode: '7601.20',
    });
    const rows = [
      { no: 1, batch: 'TA100101', container: 'CONT0000001', netMt: 2.552, grossMt: 2.562 },
      { no: 2, batch: 'TA100102', container: 'CONT0000001', netMt: 2.552, grossMt: 2.562 },
      { no: 3, batch: 'TB200201', container: 'CONT0000002', netMt: 2.551, grossMt: 2.561 },
    ];
    const text = strip(renderGeneratedHtml('CUSTOMER_PL', h, [], rows));
    for (const s of [
      '様式2 2025年8月18日',
      '計量検収票',
      'INVOICE NO : XP2652101585 DATE: 12/08/2026',
      'Net Wt. : 7.655',
      'No. of Bundles : 3',
      'Port of Discharge : NAGOYA, JAPAN',
      'Goods Description: ALUMINIUM BILLET ALLOY 6005 203 MM X 5800 MM COUNTRY OF ORIGIN : INDIA HS CODE : 7601.20',
      'Applicant : ASIA DEAL HUB PTE. LTD.',
      'Container ID Sr. No. Batch No Net Weight(MT) Gross weight(MT)',
      'CONT0000001 1 TA100101 2.552 2.562 2 TA100102 2.552 2.562 Sub Total 5.104 5.124 CONT0000002 1 TB200201 2.551 2.561 Sub Total 2.551 2.561',
      'TOTAL 7.655 7.685',
    ])
      expect(text).toContain(s);
  });
});

describe('document settings (TradeSetting.docDefaults) patch', () => {
  it('replaces listed keys, null removes, keeps the rest', () => {
    expect(mergeDocDefaults({ a: 'x', siTo: 'old' }, { siTo: 'new', a: null })).toEqual({ siTo: 'new' });
  });
  it('checks banks, delivery profiles and the seal image', () => {
    expect(() => mergeDocDefaults({}, { banks: [{ id: 'a', label: 'A' }] })).toThrow(BadRequestException);
    expect(() => mergeDocDefaults({}, { deliveryProfiles: 'x' })).toThrow(BadRequestException);
    expect(() => mergeDocDefaults({}, { sealImage: 'data:image/svg+xml;base64,PHN2Zz4=' })).toThrow(/PNG or JPEG/);
    expect(() => mergeDocDefaults({}, { sealImage: `data:image/png;base64,${Buffer.alloc(1024 * 1024 + 1).toString('base64')}` })).toThrow(/1 MB/);
    expect(mergeDocDefaults({}, { sealImage: 'data:image/png;base64,iVBORw0KGgo=' })).toEqual({ sealImage: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(() => mergeDocDefaults({}, { 'bad key': 'x' })).toThrow(/Unknown/);
    expect(() => mergeDocDefaults({}, { invoiceFromBlock: { nested: true } })).toThrow(/text/);
  });
});
