/**
 * Round BO — Kato's 請求書 (style 2) against ADH's own PDFs of 9 Nov 2026 (202611_01 6063, 202611_02 6005) and the
 * correction 202610_004; the step 2 switch; the 番号 series.
 */
import { actualsDraft, correctionDraft, customsWeekLabel, KATO_REMARKS_TEMPLATE, KATO_UPCHARGE_TEMPLATE, nextKatoInvoiceNo, renderKatoInvoiceHtml } from './trade-invoice-kato';
import { singleGoodsRemarks, SingleInvoiceHeader, SingleLine, singleLineCalc, singleTotals } from './trade-invoice-single';
import { naStepCodes, profileFor, stepOverride } from './trade-profile';
import { mergeProfiles } from './trade-profile';
import { addBusinessDays } from './trade-invoice';

const FX = 157.63;
const block = ' 商　品：アルミビレット';
const kato = (grade: string, qty: number, premium: number, customsJpy: number): SingleLine[] => [
  { kind: 'goods', description: `アルミニウムビレット ${grade} 8インチ\nカスタマイズ品`, quantity: qty, lme: 3061.11, qmjp: 255, premium, upcharge: null, taxable: true, remarks: '', grade },
  { kind: 'jpy', description: '通関、車輸送料\n　課税対象　消費税率10％', quantity: null, jpyAmount: customsJpy, taxable: true, remarks: block },
  { kind: 'jpy', description: '通関\n　課税対象外', quantity: null, jpyAmount: 93000, taxable: false, remarks: block },
  { kind: 'usd', description: '他諸掛\n　課税対象　消費税率10％', quantity: qty, unitPrice: 40, taxable: true, remarks: '40USD/MT' },
];
// 通関、車輸送料 = qty × ¥2,300 + 4 trucks × ¥26,000 + qty × ¥200 (Kato's customs rate, 10 t trucks, storage).
const customs = (q: number) => q * 2300 + 4 * 26000 + q * 200;

describe('round BO — Kato 請求書 figures = ADH 202611_01 / _02', () => {
  it('6063 8" 40.271 t (202611_01): every line, total and yen figure', () => {
    const rows = kato('6063', 40.271, 260, customs(40.271));
    const t = singleTotals(rows, 10, FX, 2);
    expect(t.lines.map((c) => [c.unitUsd, c.amountUsd, c.unitJpy, c.amountJpy])).toEqual([
      [3576.11, 144013.52, 563702, 22700852],
      [1298.46, 1298.46, 204678, 204678],
      [589.98, 589.98, 93000, 93000],
      [40, 1610.84, 6305, 253916],
    ]);
    expect(t.usd).toEqual({ nonTaxable: 589.98, taxable: 146922.82, tax: 14692.28, total: 162205.08 });
    expect(t.jpy).toEqual({ nonTaxable: 93000, taxable: 23159446, tax: 2315945, total: 25568391 });
  });

  it('6005 8" 40.855 t (202611_02)', () => {
    const t = singleTotals(kato('6005', 40.855, 285, customs(40.855)), 10, FX, 2);
    expect(t.lines.map((c) => [c.amountUsd, c.unitJpy, c.amountJpy])).toEqual([
      [147123.34, 567643, 23191053],
      [1307.73, 206138, 206138],
      [589.98, 93000, 93000],
      [1634.2, 6305, 257598],
    ]);
    expect(t.usd).toEqual({ nonTaxable: 589.98, taxable: 150065.27, tax: 15006.52, total: 165661.77 });
    expect(t.jpy).toEqual({ nonTaxable: 93000, taxable: 23654789, tax: 2365479, total: 26113268 });
  });

  it('the older (Sept sheet) rounding is unchanged for drafts without style 2', () => {
    expect(singleLineCalc(kato('6063', 40.271, 260, 0)[0], FX).amountUsd).toBe(144013.53);
  });

  it('billet 備考, due date, rate label, 番号 series', () => {
    const r = kato('6063', 40.271, 260, 0)[0];
    expect(singleGoodsRemarks(r, '2026-10', KATO_REMARKS_TEMPLATE, KATO_UPCHARGE_TEMPLATE)).toBe('LME Cash\n10月平均 3061.11\n+ Q4 MJP 255.0\n+ Billet Premium 260');
    expect(addBusinessDays('2026-11-09', 5)).toBe('2026-11-16');
    expect(customsWeekLabel('2026-11-08', '2026-11-14')).toBe('11/8-11/14');
    expect(nextKatoInvoiceNo('2026-11-09', [])).toBe('202611_01');
    expect(nextKatoInvoiceNo('2026-11-20', ['202611_01', '番号 202611_02', '202610_004'])).toBe('202611_03');
    expect(nextKatoInvoiceNo('2026-10-20', ['202610_003', '202610_004'])).toBe('202610_005');
  });

  it('renders the Kato layout: no 有効期限 / per-MT row, 一式 lines, お支払い期限, 円貨 note', () => {
    const h = { layout: 'single', style: 2, title: '請求書', invoiceNo: null, issueDate: '2026-11-09', registrationNo: 'T7010403028176', toName: '加藤軽金属工業株式会社', toSuffix: '御中', subject: 'アルミニウムビレット　　6063 8 インチ', paymentTerms: '請求書発行後５営業日以内、USD建て- 弊社指定口座振込', validity: '', fromBlock: 'アジアディールハブ合同会社\n担当：竹腰 俊朗', fxRate: FX, fxNote: '11/8-11/14 関税外国為替相場', taxRate: 10, lmeMonth: '2026-10', conditions: '・トラック積替え貴社指定場所に納入（車上渡し）', paymentBlock: '', dueLine: '{date} までにお支払いをお願い致します。', bankBlock: 'Community Federal Savings Bank', dueDate: '2026-11-16', currency: 'USD' } as SingleInvoiceHeader;
    const html = renderKatoInvoiceHtml(h, kato('6063', 40.271, 260, customs(40.271)), {});
    expect(html).toContain('$162,205.08');
    expect(html).toContain('一式');
    expect(html).toContain('2026/11/16</span> までにお支払いをお願い致します。');
    expect(html).toContain('<u>11/8-11/14 関税外国為替相場</u>');
    expect(html).toContain('（確定時に採番）');
    expect(html).not.toContain('有効期限');
    expect(html).not.toContain('今回請求合計額');
  });
});

describe('round BO — 正誤差額 = ADH 202610_004 (premium 235 → 260 on 40.271 t)', () => {
  // 202610_003 as issued on 10/2 at 155.39 (Nov delivery, 6063): premium 235, the Oct sheet's LME / MJP.
  const original = {
    id: 'orig',
    number: '202610_003',
    header: { style: 2, issueDate: '2026-10-02', fxRate: 155.39, fxNote: '10/2 関税外国為替相場', taxRate: 10, subject: 'アルミニウムビレット　　6063 8 インチ', dueDate: '2026-10-09' } as unknown as SingleInvoiceHeader,
    rows: [{ kind: 'goods', description: 'アルミニウムビレット 6063 8インチ\nカスタマイズ品', quantity: 40.271, lme: 3276.82, qmjp: 395, premium: 235, upcharge: null, taxable: true, remarks: '' }] as SingleLine[],
  };

  it('bills 25.00 × 40.271 = 1,006.77 + tax 100.67 = 1,107.44 (¥156,442 + ¥15,644 at 155.39)', () => {
    const d = correctionDraft({ original, field: 'premium', to: 260, today: '2026-10-08', deliveryMonth: '2026-11', nextDeliveryMonth: '2026-12' });
    const t = singleTotals(d.rows, 10, d.header.fxRate, 2);
    expect(t.lines[0]).toEqual({ unitUsd: 25, amountUsd: 1006.77, unitJpy: 3885, amountJpy: 156442 });
    expect(t.usd).toEqual({ nonTaxable: 0, taxable: 1006.77, tax: 100.67, total: 1107.44 });
    expect(t.jpy).toEqual({ nonTaxable: 0, taxable: 156442, tax: 15644, total: 172086 });
    expect(d.rows[0].description).toBe('アルミニウムビレット 6063 8インチ\nカスタマイズ品 11月納入分\n2026/10/2発行 請求書 202610_003 との差額');
    expect(d.rows[0].remarks).toBe('Billet Premium 差額\n(USD/MT) 25.0');
    expect(d.header).toMatchObject({ paymentTerms: '12月納入分請求書と合算の上お支払い 弊社指定口座振込', dueLine: '次回ご請求書お支払い期限 までにお支払いをお願い致します。', original: { number: '202610_003' } });
    expect(d.header.subject).toBe('アルミニウムビレット　　6063 8 インチ\nビレットプレミアム差額');
    expect(d.header.fxNote).toBe('202610-003発行時使用 10/2 関税外国為替相場');
    expect(d.header.reference?.lines).toHaveLength(2);
    expect(() => correctionDraft({ original, field: 'premium', to: 235, today: '2026-10-08' })).toThrow(/already/);
  });

  it('実費差分: actual − billed per yen line; nothing to bill is refused', () => {
    const inv = { ...original, rows: kato('6063', 40.271, 260, 204677.5) };
    const d = actualsDraft({ original: inv, actualTaxableJpy: 230000, actualNonTaxableJpy: 93000, today: '2026-12-10' });
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({ kind: 'jpy', jpyAmount: 25322.5, taxable: true });
    expect(() => actualsDraft({ original: inv, actualTaxableJpy: 204677.5, actualNonTaxableJpy: 93000, today: '2026-12-10' })).toThrow(/nothing to invoice/);
  });
});

describe('round BO — Kato invoiced on step 2', () => {
  it('singleInvoiceStep INVOICE_1: step 2 stays on and takes the single invoice; default unchanged', () => {
    const base = { ...profileFor({}, 'k'), billingMode: 'SINGLE' as const };
    expect(naStepCodes(base, 'ORDER')).toContain('INVOICE_1');
    const k = { ...base, singleInvoiceStep: 'INVOICE_1' as const };
    expect(naStepCodes(k, 'ORDER')).not.toContain('INVOICE_1');
    expect(stepOverride(k, 'INVOICE_1')).toEqual({ title: 'Issue and send invoices', requiredDocTypes: ['INVOICE_SINGLE'] });
    expect(stepOverride(k, 'INVOICE_2')).toEqual({ title: 'Issue invoice (single)', requiredDocTypes: ['INVOICE_SINGLE'] }); // until the owner decides
    expect(stepOverride({ ...base, billingMode: 'TWO_STAGE' as const, singleInvoiceStep: 'INVOICE_1' as const }, 'INVOICE_1')).toEqual({});
  });

  it('a settings save keeps / validates the new fields', () => {
    const fail = (m: string): never => {
      throw new Error(m);
    };
    const K = 'a4ccfa28-9f64-468e-a943-e96ce8f8c3a0';
    const cur = { [K]: { ...profileFor({}, 'k'), billingMode: 'SINGLE', truckCapacityT: 10, singleInvoiceStep: 'INVOICE_1', customsFlatJpy: 93000 } } as any;
    const kept = mergeProfiles(cur, { [K]: { billingMode: 'SINGLE', truckCapacityT: 10 } }, fail);
    expect(kept[K]).toMatchObject({ singleInvoiceStep: 'INVOICE_1', customsFlatJpy: 93000 });
    const back = mergeProfiles(cur, { [K]: { billingMode: 'SINGLE', truckCapacityT: 10, singleInvoiceStep: 'INVOICE_2', customsFlatJpy: null } }, fail);
    expect(back[K].singleInvoiceStep).toBeUndefined();
    expect(back[K].customsFlatJpy).toBeUndefined();
    expect(() => mergeProfiles(cur, { [K]: { billingMode: 'SINGLE', truckCapacityT: 10, singleInvoiceStep: 'STEP_9' } }, fail)).toThrow(/singleInvoiceStep/);
  });
});

describe('round BO — step re-sync when Kato moves to step 2', () => {
  const { TradeConfigService, INVOICED_ON_STEP11 } = require('./trade-config.service');
  const run = async (s11: string) => {
    const steps = [
      { id: 's2', code: 'INVOICE_1', status: 'NOT_STARTED', notApplicable: true, skipReason: null, title: 'Issue and send Invoice #1', requiredDocTypes: ['INVOICE_1'], subtasks: null },
      { id: 's11', code: 'INVOICE_2', status: s11, notApplicable: false, skipReason: null, title: 'Issue invoice (single)', requiredDocTypes: ['INVOICE_SINGLE'], subtasks: null },
    ];
    const updates: any[] = [];
    const db: any = {
      tradeStep: { findMany: jest.fn(async () => steps), update: jest.fn(async (a: any) => updates.push(a)) },
      tradeStepTemplate: { findMany: jest.fn(async () => [{ code: 'INVOICE_1', title: 'Issue and send Invoice #1', requiredDocTypes: ['INVOICE_1'] }]) },
    };
    const svc = new TradeConfigService(db);
    await svc.applyProfile(db, 'org', { orderId: 'o' }, 'ORDER', { ...profileFor({}, 'k'), billingMode: 'SINGLE', singleInvoiceStep: 'INVOICE_1' });
    return updates.find((u) => u.where.id === 's2')?.data;
  };
  it('an open order not yet invoiced: step 2 on, titled for the single invoice', async () => {
    expect(await run('IN_PROGRESS')).toMatchObject({ notApplicable: false, requiredDocTypes: ['INVOICE_SINGLE'], title: 'Issue and send invoices' });
  });
  it('an order already invoiced on step 11 (Kato #13–#22): step 2 stays off with the reason', async () => {
    const d = await run('DONE');
    expect(d).toMatchObject({ skipReason: INVOICED_ON_STEP11 });
    expect(d.notApplicable).toBeUndefined(); // stays N/A
  });
});
