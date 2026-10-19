/**
 * Orders (Contract → Order → Shipment), customer profiles, the cost / import
 * tax estimator, the single invoice and the step 13 reconciliation — the pure
 * parts, checked against ADH's numbers.
 */
import { blockingSteps, currentStepOf, monthsLabel, orderLabel, progressOf, shipmentRef, autoCompletePlan } from './shipments.rules';
import { docRefCode, nextDocRef, orderDocRefBase } from './trade-docref';
import { actualsTable, cleanCosts, DEFAULT_RATES, estimate, importTaxEstimate, ratesOf, suggestedCostLinesUsd, trucksFor } from './trade-estimator';
import { renderSingleInvoiceHtml, SingleInvoiceHeader, singleInvoiceNoFor, SingleLine, singleFinalizeProblems, singleGoodsRemarks, singleTotals } from './trade-invoice-single';
import { dueBusinessDays, invoiceTotals, toInvoiceLines } from './trade-invoice';
import { CUSTOMER_DOC_TEMPLATES, defaultSingleRemarks, invoiceDueDays, mergeProfiles, naStepCodes, profileFor, stepOverride, subtasksFor, templateKeyFor } from './trade-profile';
import { reconcile } from './trade-reconcile';
import { defaultLine, orderProductLabel } from './orders.service';
import { mergeCosts } from './shipments.service';
import { inchJa, orderLine } from './trade-generated.service';

const fail = (m: string): never => {
  throw new Error(m);
};

describe('order / shipment labels and document IDs', () => {
  it('"#19", "#19-1", "Sep 26 → Nov 26"', () => {
    expect(orderLabel({ orderNo: 19 })).toBe('#19');
    expect(shipmentRef(19, 1)).toBe('#19-1');
    expect(shipmentRef(19, null)).toBe('#19');
    expect(shipmentRef(null, 2)).toBe('');
    expect(monthsLabel('2026-09', '2026-11')).toBe('Sep 26 → Nov 26');
  });

  it('new docRef format: 26-19-1-CPL on a shipment, 26-19-INV1 on an order, repeats counted', () => {
    expect(orderDocRefBase({ year: 2026, orderNo: 19, seqNo: 1 }, 'CUSTOMER_PL')).toBe('26-19-1-CPL');
    expect(orderDocRefBase({ year: 2026, orderNo: 19 }, 'INVOICE_1')).toBe('26-19-INV1');
    expect(orderDocRefBase({ year: 2027, orderNo: 3, seqNo: 2 }, 'SGJP_IV_PL')).toBe('27-3-2-SGJP');
    expect(docRefCode('INVOICE_SINGLE')).toBe('INV');
    expect(nextDocRef('26-19-1-SGJP', ['26-19-1-SGJP'])).toBe('26-19-1-SGJP-2');
    // "26-19-1-PL" must not be counted as a repeat of "26-19-1-P"… nor of "26-1-…".
    expect(nextDocRef('26-1-1-PL', ['26-11-1-PL', '26-1-1-PLX'])).toBe('26-1-1-PL');
  });

  it('order product label and the contract line an order defaults from', () => {
    expect(orderProductLabel({ grade: '6005', size: '203 MM', qtyMt: 40 })).toBe('6005 · 203 MM · 40 MT');
    const lines = [
      { id: 'a', grade: '6063' },
      { id: 'b', grade: '6005' },
    ];
    expect(defaultLine(lines, '6005')?.id).toBe('b');
    expect(defaultLine(lines, '1100')).toBeNull();
    expect(defaultLine([{ id: 'x', grade: '6063' }], null)?.id).toBe('x');
  });
});

describe('customer profiles', () => {
  const kato = profileFor({ k: { billingMode: 'SINGLE', sendImportPermit: false, truckCapacityT: 10, docVariants: { CUSTOMER_PL: 'CUSTOMER_PL_KATO', INVOICE: 'INVOICE_SINGLE' } } }, 'k');
  const sus = profileFor({}, 's');

  it('SINGLE: Invoice #1 N/A, step 11 issues INVOICE_SINGLE, import-permit sub-task N/A', () => {
    expect(naStepCodes(kato, 'ORDER')).toEqual(['INVOICE_1']);
    expect(naStepCodes(kato, 'SHIPMENT')).toEqual([]);
    expect(stepOverride(kato, 'INVOICE_2')).toEqual({ title: 'Issue invoice (single)', requiredDocTypes: ['INVOICE_SINGLE'] });
    expect(subtasksFor('IMPORT_PERMIT', kato)?.[0]).toMatchObject({ key: 'sentToCustomer', na: true });
    expect(templateKeyFor(kato, 'CUSTOMER_PL')).toBe('CUSTOMER_PL_KATO');
    expect(templateKeyFor(kato, 'INVOICE_SINGLE')).toBe('INVOICE_SINGLE');
  });

  it('TWO_STAGE default (no profile): steps as before, permit sent', () => {
    expect(sus.billingMode).toBe('TWO_STAGE');
    expect(naStepCodes(sus, 'ORDER')).toEqual([]);
    expect(stepOverride(sus, 'INVOICE_2')).toEqual({});
    expect(subtasksFor('IMPORT_PERMIT', sus)?.[0].na).toBeUndefined();
    expect(subtasksFor('INVOICE_1', sus)).toEqual([{ key: 'sent', label: 'Sent to customer', done: false, na: undefined }]);
  });

  it('due-date defaults: Invoice #1 7, Invoice #2 6, single 5 business days (editable)', () => {
    expect(invoiceDueDays('INVOICE_1', {})).toBe(7);
    expect(invoiceDueDays('INVOICE_2', {})).toBe(6);
    expect(invoiceDueDays('INVOICE_SINGLE', {})).toBe(5);
    expect(dueBusinessDays({}, 'INVOICE_SINGLE')).toBe(5);
    expect(dueBusinessDays({ invoiceSingleDueBusinessDays: 3 }, 'INVOICE_SINGLE')).toBe(3);
  });

  it('template variants: Kato confirmed, SUS / Hoei copies not yet confirmed', () => {
    expect(CUSTOMER_DOC_TEMPLATES.CUSTOMER_PL_KATO.formatConfirmed).toBe(true);
    expect(CUSTOMER_DOC_TEMPLATES.CUSTOMER_PL_SUS.formatConfirmed).toBe(false);
    expect(CUSTOMER_DOC_TEMPLATES.CUSTOMER_COA_HOEI.formatConfirmed).toBe(false);
  });

  it('profile patches are validated', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const out = mergeProfiles({}, { [id]: { billingMode: 'SINGLE', truckCapacityT: 10, docVariants: { INVOICE: 'INVOICE_SINGLE' }, emailDomains: ['@Kato.Example.jp'] } }, fail);
    expect(out[id]).toMatchObject({ billingMode: 'SINGLE', sendImportPermit: true, truckCapacityT: 10, emailDomains: ['kato.example.jp'] });
    expect(() => mergeProfiles({}, { [id]: { billingMode: 'X', truckCapacityT: 10 } }, fail)).toThrow('billingMode');
    expect(() => mergeProfiles({}, { [id]: { billingMode: 'SINGLE', truckCapacityT: 10, docVariants: { INVOICE: 'NOPE' } } }, fail)).toThrow('Unknown template');
    expect(mergeProfiles(out, { [id]: null }, fail)[id]).toBeUndefined();
  });
});

describe('N/A steps (customer profile) never block', () => {
  const steps = [
    { id: '1', code: 'CHECK_CONTRACT', title: 'Check contract', status: 'DONE', isOngoing: false, sortOrder: 5, requiredDocTypes: [] },
    { id: '2', code: 'INVOICE_1', title: 'Invoice #1', status: 'NOT_STARTED', isOngoing: false, sortOrder: 20, requiredDocTypes: ['INVOICE_1'], notApplicable: true },
    { id: '3', code: 'XERO_HANDOFF', title: 'Xero', status: 'NOT_STARTED', isOngoing: false, sortOrder: 130, requiredDocTypes: [] },
  ];
  it('skips them for blocking, progress and the current step', () => {
    expect(blockingSteps(steps).map((s) => s.id)).toEqual(['3']);
    expect(progressOf(steps)).toEqual({ done: 1, total: 2 });
    expect(currentStepOf(steps)?.code).toBe('XERO_HANDOFF');
  });
  it('auto-complete never completes an N/A step', () => {
    const plan = autoCompletePlan(steps, ['INVOICE_1'], {});
    expect(plan.complete.map((s) => s.id)).toEqual([]);
    expect(plan.start?.id).toBe('3');
  });
});

describe('estimator (task-list formulas, JPY)', () => {
  const rates = ratesOf(null);

  it('trucks = ROUND(gross / capacity): 307.004t on 20t trucks (SUS) → 15, 263.48t on 20t (SUS) → 13, 40.825t on 10t (Kato) → 4', () => {
    expect(trucksFor(307.004, 20)).toBe(15);
    expect(trucksFor(263.48, 20)).toBe(13);
    expect(trucksFor(40.825, 10)).toBe(4);
  });

  it('#11: customs 305.804 × 3,080 = ¥941,876; est. 通関・車輸送 ¥1,526,676; trucking 15 → ¥1,617,000', () => {
    const e = estimate({ netWeightMt: 305.804, grossWeightMt: 307.004 }, { thc: 540000, docFee: 6000, equipmentFee: 27000 }, rates, { truckCapacityT: 20, customsRatePerMt: 2800 });
    expect(e.customs).toBe(941876);
    expect(e.blFee).toBe(11800);
    expect(e.anCharges).toBe(573000);
    expect(e.customsTotal).toBe(1526676);
    expect(e.trucks).toBe(15);
    expect(e.trucking).toBe(1617000);
  });

  it('#9-1: 262.45 MT → customs ¥808,346; trucks 13 (gross 263.48)', () => {
    const e = estimate({ netWeightMt: 262.45, grossWeightMt: 263.48 }, {}, rates, { truckCapacityT: 20 });
    expect(e.customs).toBe(808346);
    expect(e.trucks).toBe(13);
  });

  it('Nagoya (Kato): ¥2,300/MT and ¥26,000 per 10t truck; trucks editable', () => {
    const e = estimate({ netWeightMt: 40.825, grossWeightMt: 41.2 }, { trucks: 5 }, rates, { truckCapacityT: 10, customsRatePerMt: 2300 });
    expect(e.customsRatePerMt).toBe(2300);
    expect(e.truckRate).toBe(26000);
    expect(e.trucksSuggested).toBe(4);
    expect(e.trucks).toBe(5);
    expect(e.trucking).toBe(143000);
  });

  it('import tax (step 8): the permit formula — #11 SG→JP IV CIF 1,156,238.80 × 159.00 + 加算運賃 ¥27,000 (= EQMC) → ¥18,386,700', () => {
    expect(importTaxEstimate(1156238.8, 159, 27000)).toMatchObject({ customsValue: 183868969, national: 14341700, local: 4045000, total: 18386700 });
    // The add-on defaults to the A/N's EQMC …
    const e = estimate({ netWeightMt: 305.804 }, { equipmentFee: 27000, cifUsd: 1156238.8, fxRate: 159, importTaxFunded: 20000000, importTaxActual: 18386700 }, rates, {});
    expect(e.importTax).toMatchObject({ addOnJpy: 27000, addOnSource: 'EQMC', customsValue: 183868969, estimate: 18386700, funded: 20000000, actual: 18386700, variance: 0 });
    // … and a typed 加算運賃 wins.
    const typed = estimate({ netWeightMt: 305.804 }, { equipmentFee: 27000, customsAddOnJpy: 0, cifUsd: 1156238.8, fxRate: 159 }, rates, {});
    expect(typed.importTax).toMatchObject({ addOnJpy: 0, addOnSource: 'typed', customsValue: 183841969 });
  });

  it('step 12 actuals: washing / detention per container + tax, variance per line', () => {
    const e = estimate({ netWeightMt: 305.804, grossWeightMt: 307.004 }, { thc: 540000, docFee: 6000, equipmentFee: 27000 }, rates, { truckCapacityT: 20 });
    const t = actualsTable(e, { actual: { customs: 1514876, blFee: 11800, trucking: 1617000, storage: 71760, washingContainers: 3, detentionContainers: 1 } }, rates);
    const row = (k: string) => t.rows.find((r) => r.key === k)!;
    expect(row('customs').estimate).toBe(941876 + 573000);
    expect(row('customs').variance).toBe(1514876 - 1514876);
    expect(row('washing').actual).toBe(19800); // 3 × 6,000 × 1.1
    expect(row('detention').actual).toBe(4400);
    expect(row('trucking').variance).toBe(0);
    expect(t.actual).toBe(1514876 + 11800 + 1617000 + 71760 + 19800 + 4400);
  });

  it('suggested Invoice #2 cost lines in USD at the invoice FX', () => {
    const e = estimate({ netWeightMt: 305.804, grossWeightMt: 307.004 }, { thc: 540000, docFee: 6000, equipmentFee: 27000 }, rates, { truckCapacityT: 20 });
    expect(suggestedCostLinesUsd(e, 159)).toEqual({ customsTaxable: Math.floor(((1526676 - 11800 + 1617000) / 159) * 100) / 100, customsNonTaxable: 74.21 });
    expect(suggestedCostLinesUsd(e, null)).toEqual({ customsTaxable: null, customsNonTaxable: null });
  });

  it('rates and cost patches are validated / merged', () => {
    expect(ratesOf({ blFee: 12000, truckRates: { '4': 18000 } }).truckRates).toEqual({ ...DEFAULT_RATES.truckRates, '4': 18000 });
    expect(() => cleanCosts({ trucks: -1 }, fail)).toThrow('trucks');
    expect(mergeCosts({ thc: 1, actual: { customs: 5 } }, { docFee: 2, actual: { trucking: 7 } })).toEqual({ thc: 1, docFee: 2, actual: { customs: 5, trucking: 7 } });
  });
});

describe('INVOICE_SINGLE (Kato sample: 40.825 t, FX 159.00 → US$176,050.94)', () => {
  const rows: SingleLine[] = [
    { kind: 'goods', description: 'アルミニウムビレット6005', quantity: 40.825, lme: 3155.98, qmjp: 395, premium: 285, taxable: true, remarks: '' },
    { kind: 'jpy', description: '通関、車輸送料', quantity: 40.825, jpyAmount: 40.825 * 2300 + 26000 * 4 + 40.825 * 200, taxable: true, remarks: defaultSingleRemarks('名古屋') },
    { kind: 'jpy', description: '通関', quantity: 40.825, jpyAmount: 89800, taxable: false, remarks: defaultSingleRemarks('名古屋') },
    { kind: 'usd', description: '他諸掛', quantity: 40.825, unitPrice: 40, taxable: true, remarks: '40USD/MT' },
  ];
  const t = singleTotals(rows, 10, 159);

  it('line figures match the PDF', () => {
    expect(t.lines[0]).toMatchObject({ unitUsd: 3835.98, amountUsd: 156603.88, amountJpy: 24900017 });
    expect(Math.round(t.lines[0].unitJpy!)).toBe(609921);
    // 単価(円) of a yen line = ROUND(amount USD × FX / qty, 2) as the sheet does; printed to the yen (5,047 / 2,200).
    expect(t.lines[1]).toMatchObject({ unitUsd: 31.75, amountUsd: 1295.99, unitJpy: 5047.46, amountJpy: 206063 });
    expect(t.lines[2]).toMatchObject({ unitUsd: 13.83, amountUsd: 564.78, unitJpy: 2199.63, amountJpy: 89800 });
    expect(t.lines[3]).toMatchObject({ unitUsd: 40, amountUsd: 1633, unitJpy: 6360, amountJpy: 259647 });
  });

  it('totals: 非課税 564.78 / 課税対象 159,532.87 / 消費税 15,953.29 / 合計 176,050.94 (¥27,992,100)', () => {
    expect(t.usd).toEqual({ nonTaxable: 564.78, taxable: 159532.87, tax: 15953.29, total: 176050.94 });
    expect(t.jpy).toEqual({ nonTaxable: 89800, taxable: 25365727, tax: 2536573, total: 27992100 });
    expect(t.perMt.usd).toBe(3921.56);
  });

  it('per-MT yen row = 623,527.91 as printed (609,920.82 + 5,047.46 + 2,199.63 + 6,360)', () => {
    expect(t.lines[0].unitJpy).toBe(609920.82);
    expect(t.perMt.jpy).toBe(623527.91);
  });

  it('番号 defaults to the 発行日 as yyyymmdd (2026-08-18 → 20260818)', () => {
    expect(singleInvoiceNoFor('2026-08-18')).toBe('20260818');
    expect(singleInvoiceNoFor('')).toBe('');
  });

  it('goods remarks: LME Cash 2026/7月平均(3155.98USD) +395(3QMJP) + 285(Billet Premium)', () => {
    expect(singleGoodsRemarks(rows[0], '2026-07')).toBe('LME Cash 2026/7月平均(3155.98USD) +395(3QMJP) + 285(Billet Premium)');
  });

  it('finalize needs the FX and the LME', () => {
    expect(singleFinalizeProblems(rows, null)[0]).toMatch('exchange rate');
    expect(singleFinalizeProblems([{ ...rows[0], lme: null }, ...rows.slice(1)], 159)).toContain('line 1 needs the LME');
    expect(singleFinalizeProblems(rows, 159)).toEqual([]);
  });

  it('renders the header fields, the seven columns, the 備考 block once and the totals', () => {
    const h: SingleInvoiceHeader = {
      layout: 'single',
      title: '請　求　書',
      invoiceNo: '20260818',
      issueDate: '2026-08-18',
      registrationNo: '',
      toName: '加藤軽金属工業株式会社',
      toSuffix: '御中',
      subject: 'アルミニウムビレット品 6005 8インチ',
      paymentTerms: 'BLコピー提供・請求書発行後５営業日以内、弊社指定口座振込',
      validity: '請求書発行後 5営業日以内 弊社指定口座振込',
      fromBlock: 'アジアディールハブ合同会社',
      fxRate: 159,
      fxNote: '円/USD 税関 8/23～8/29 外国為替相場参照',
      taxRate: 10,
      lmeMonth: '2026-07',
      conditions: '・トラック積替え貴社指定場所に納入（車上渡し）',
      paymentBlock: '・BLコピー提供',
      bankBlock: 'Community Federal Savings Bank',
      dueDate: '2026-08-25',
      currency: 'USD',
    };
    const html = renderSingleInvoiceHtml(h, rows);
    // 税率別内訳: 税込金額 is the grand total in both rows, as on ADH's sheet (¥27,992,100 / USD 176,050.94).
    expect(html).toContain('¥27,992,100</td></tr>');
    expect(html).not.toContain('¥27,902,300');
    for (const s of [
      '番号：',
      '発行日：',
      '件名：',
      '支払条件：',
      '有効期限：',
      '合計(税込)',
      'US$176,050.94',
      '単価(円)',
      '金額(円)',
      '非課税合計',
      '課税対象合計',
      '今回請求合計額',
      '27,992,100',
      '159.00',
      '弊社指定口座',
    ])
      expect(html).toContain(s);
    expect(html.match(/保管倉庫/g)?.length).toBe(1); // merged 備考 cell
    expect(html).toContain('rowspan="2"');
  });
});

describe('order-era invoice helpers', () => {
  it('the order as a product line: premium = client premium', () => {
    expect(orderLine({ id: 'o', grade: '6005', product: 'Aluminium Billet', size: '203 MM', qtyMt: 40, tolPct: 5, clientPremium: 285, upcharge: null })).toMatchObject({
      grade: '6005',
      sizeSpec: '203 MM',
      quantityMt: 40,
      tolerancePct: 5,
      billetPremium: 285,
    });
    expect(inchJa('203 MM X 5800 MM', { sizeInch: { '203': '8 inch' } })).toBe('8インチ');
  });
});

describe('step 13 reconciliation: profit = d − a − b − c', () => {
  it('#11: PI 120,958.50 · CI 1,027,635.21 · Invoice #2 total 1,303,821.69 · costs 137,185.55 → profit 18,042.43', () => {
    const inv1 = toInvoiceLines([{ description: 'Aluminium Billet', quantity: 1, unitPrice: 1212042, taxable: true }]);
    const t1 = invoiceTotals(inv1, 10, null);
    expect(t1).toMatchObject({ subtotal: 1212042, tax: 121204.2, total: 1333246.2 });
    const r = reconcile(
      { piPaid: 120958.5, ciPaid: 1027635.21, otherCostsUsd: 137185.55 },
      {
        invoice1: { number: 'ADH-INV-2026-0001', goods: t1.subtotal, tax: t1.tax, total: t1.total },
        sgjpTotal: 1156238.8,
        invoice2: { numbers: ['ADH-INV-2026-0002'], lines: [], total: 1303821.69, tax: 118522.49, taxable: 1185224.99, nonTaxable: 74.21 },
        single: null,
      },
    );
    expect(r).toMatchObject({ a: 120958.5, b: 1027635.21, c: 137185.55, d: 1303821.69, profit: 18042.43 });
  });

  it('defaults a / b from the PI deposit and the CI amount; JPY costs at the FX', () => {
    const r = reconcile(
      { importTaxActualJpy: 18845077, mitsuiActualsJpy: 2675692 },
      { invoice1: null, sgjpTotal: null, invoice2: { numbers: [], lines: [], total: 1000, tax: 0, taxable: 1000, nonTaxable: 0 }, single: null },
      { piDeposit: 100, ciAmount: 200, fxRate: 159 },
    );
    expect(r.a).toBe(100);
    expect(r.b).toBe(200);
    expect(r.costs.importTaxUsd).toBe(118522.5);
    expect(r.costs.mitsuiUsd).toBe(16828.25);
  });
});
