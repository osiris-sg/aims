/**
 * Round E (2026-10, ADH meeting): supplier / customer orders, contract master
 * + price check, entities, payments, credit notes, alerts, the pipeline grid,
 * carriers, stock, intake rules — the pure parts, on ADH's own numbers.
 */
import { allocationState, cleanPayment, invoiceCash } from './trade-payments';
import { creditLine, costVariance, estimatedCostsUsd, isCreditNote, adjustmentLine } from './trade-credit';
import { invoiceTotals, InvoiceLine, amountOf } from './trade-invoice';
import { bankEntity, entityFor, entityProblem } from './trade-entity';
import { alertRulesOf, cleanAlertRules, etaTrail, planShipmentAlerts, planInvoiceAlert, reconcileAlert, withEtaChange, ShipmentFacts } from './trade-alerts';
import { cellState, orderMargin, pipelineGrid, cashByMonth } from './trade-dashboard';
import { cleanPremiumSchedule, marginAt, premiumAt, priceCheck, quarterOf } from './trade-contract';
import { carrierOf } from './trade-carrier';
import { diameterOf, folderFileNames, shipmentFolderName } from './trade-folder';
import { deliveredBundles, stockLine, storagePeriods } from './trade-stock';
import { defaultSupplierProfile, mergeSupplierProfiles, naStepCodes, profileFor, stepOverride } from './trade-profile';
import { supplierOrderDocRefBase } from './trade-docref';
import { supplierOrderLabel } from './shipments.rules';
import { addMonths } from './supplier-orders.service';
import { declarationMonthOf, knownSender, parseDeclarationTable } from '../ingestion-email/email-triage.rules';

const fail = (m: string): never => {
  throw new Error(m);
};

describe('payments — one Wise transfer paying two CIs and two PIs (Jul 24)', () => {
  const allocations = [
    { targetType: 'CI', targetId: '11111111-1111-1111-1111-111111111111', amount: 944256.79 },
    { targetType: 'CI', targetId: '22222222-2222-2222-2222-222222222222', amount: 146868.33 },
    { targetType: 'PI', targetId: '33333333-3333-3333-3333-333333333333', amount: 44358.72 },
    { targetType: 'PI', targetId: '44444444-4444-4444-4444-444444444444', amount: 112186.8 },
  ];
  it('USD 1,247,670.64 is fully allocated, to the cent', () => {
    const p = cleanPayment({ direction: 'OUT', paidAt: '2026-07-24', amount: 1247670.64, currency: 'USD', account: 'WISE', allocations }, fail);
    expect(p.allocations).toHaveLength(4);
    expect(allocationState(p.amount, p.allocations)).toEqual({ allocated: 1247670.64, unallocated: 0, over: false, complete: true });
  });
  it('a missing line leaves the rest unallocated; more than the amount is refused', () => {
    expect(allocationState(1247670.64, allocations.slice(0, 3))).toMatchObject({ unallocated: 112186.8, complete: false });
    expect(() => cleanPayment({ direction: 'OUT', paidAt: '2026-07-24', amount: 1000, currency: 'USD', account: 'WISE', allocations }, fail)).toThrow('more than the payment');
  });
  it('a customer invoice is cash in, a PI cash out', () => {
    expect(() => cleanPayment({ direction: 'IN', paidAt: '2026-07-24', amount: 10, currency: 'USD', account: 'CFSB', allocations: [{ targetType: 'PI', amount: 10 }] }, fail)).toThrow('cash out');
  });
  it('invoice cash: outstanding and overdue', () => {
    expect(invoiceCash(176050.94, 100000, '2026-08-25', '2026-08-28')).toMatchObject({ outstanding: 76050.94, overdue: true, daysOverdue: 3 });
    expect(invoiceCash(176050.94, 176050.94, '2026-08-25', '2026-08-28')).toMatchObject({ outstanding: 0, overdue: false });
  });
});

describe('credit notes and early Invoice #2', () => {
  it('a negative Invoice #2 is a credit note; its credit offsets a later Invoice #1 without tax', () => {
    expect(isCreditNote('INVOICE_2', -1234.5)).toBe(true);
    expect(isCreditNote('INVOICE_1', -1234.5)).toBe(false);
    const goods: InvoiceLine = { description: 'Billet 6063', quantity: 300, unit: 'MT', unitPrice: 4000, amountOverride: null, remarks: '', dueDate: null };
    const credit = creditLine({ id: 'c1', amount: 15000, sourceNumber: 'ADH-INV-2026-0009' });
    expect(credit.description).toBe('前回差額充当 (ADH-INV-2026-0009)');
    const t = invoiceTotals([goods, credit], 10, null);
    // 1,200,000 goods + 10% tax − 15,000 credit (no tax on the credit line).
    expect(t.total).toBe(1200000 * 1.1 - 15000);
  });
  it('estimated costs vs actuals → variance; adjustment line', () => {
    const rows = [
      { description: 'Billet', shipmentId: 's1', lme: 3000, unitPrice: null, quantity: 1, amountOverride: 3000 },
      { description: '通関、車輸送料', unitPrice: 10000, quantity: 1, amountOverride: null },
      { description: '通関', unitPrice: 74.21, quantity: 1, amountOverride: null },
    ];
    const est = estimatedCostsUsd('INVOICE_2', rows, (r) => amountOf(r as unknown as InvoiceLine));
    expect(est).toBe(10074.21);
    const v = costVariance(est, [1617000, 15000], 159);
    expect(v).toMatchObject({ complete: true, actualJpy: 1632000, actualUsd: 10264.15, varianceUsd: 189.94 });
    expect(costVariance(est, [1617000, null], 159).complete).toBe(false);
    expect(adjustmentLine('ADH-INV-2026-0012', 189.94, null).amountOverride).toBe(189.94);
  });
});

describe('entities: ADH JP / ADH SG', () => {
  it('customer documents are ADH JP, the SG→JP IV/PL ADH SG; a customer invoice is never ADH SG', () => {
    expect(entityFor('INVOICE_1')).toBe('ADH_JP');
    expect(entityFor('CUSTOMER_PL')).toBe('ADH_JP');
    expect(entityFor('SGJP_IV_PL')).toBe('ADH_SG');
    expect(entityProblem('INVOICE_2', 'ADH_SG')).toMatch('not by Asia Deal Hub Pte. Ltd.');
    expect(entityProblem('INVOICE_SINGLE', 'ADH_JP')).toBeNull();
    expect(entityProblem('SGJP_IV_PL', 'ADH_SG')).toBeNull();
  });
  it('bank accounts: DBS / Wise / CFSB = SG, SMBC JPY = JP', () => {
    expect(bankEntity({ label: 'DBS Bank Ltd' })).toBe('ADH_SG');
    expect(bankEntity({ label: 'Community Federal Savings Bank' })).toBe('ADH_SG');
    expect(bankEntity({ label: 'SMBC JPY 普通' })).toBe('ADH_JP');
    expect(bankEntity({ label: 'Wise', entity: 'ADH_JP' })).toBe('ADH_JP');
  });
});

describe('alerts and the ETA history', () => {
  const rules = alertRulesOf({});
  const ship = (eta: string, extra: Partial<ShipmentFacts> = {}): ShipmentFacts => ({
    id: 's1',
    ref: '#11-1',
    orderId: 'o1',
    status: 'OPEN',
    eta: new Date(eta),
    dischargeDate: null,
    detFreeDays: null,
    demFreeDays: null,
    hasCi: true,
    hasAn: false,
    taxFunded: false,
    cleared: false,
    ...extra,
  });
  it('CI received → tax funding at ETA − 14 days, A/N at ETA − 2; free time DET 4 / DEM 10 warned a day before', () => {
    const a = planShipmentAlerts(ship('2026-08-24'), rules);
    const due = (k: string) => a.find((x) => x.key === k)!.dueAt.toISOString().slice(0, 10);
    expect(due('TAX_FUNDING:s1')).toBe('2026-08-10');
    expect(due('AN_EXPECTED:s1')).toBe('2026-08-22');
    expect(due('FREE_TIME:DET:s1')).toBe('2026-08-27');
    expect(due('FREE_TIME:DEM:s1')).toBe('2026-09-02');
  });
  it('no CI yet → no tax / A/N reminders; funded / A/N in → resolved', () => {
    expect(planShipmentAlerts(ship('2026-08-24', { hasCi: false }), rules).filter((x) => x.kind === 'TAX_FUNDING')).toHaveLength(0);
    const r = planShipmentAlerts(ship('2026-08-24', { taxFunded: true, hasAn: true }), rules);
    expect(r.find((x) => x.kind === 'TAX_FUNDING')!.resolved).toBe(true);
    expect(r.find((x) => x.kind === 'AN_EXPECTED')!.resolved).toBe(true);
  });
  it('the ETA moves 8/6 → 8/16 → 8/17: history kept, reminders re-scheduled and notified again', () => {
    let h = withEtaChange(null, new Date('2026-08-06'), new Date('2026-08-16'), 'Sayaka', 'MANUAL');
    h = withEtaChange(h, new Date('2026-08-16'), new Date('2026-08-17'), 'Sayaka', 'AN');
    expect(etaTrail(h)).toBe('8/6 → 8/16 → 8/17');
    expect(withEtaChange(h, new Date('2026-08-17'), new Date('2026-08-17'), null, 'MANUAL')).toHaveLength(2);
    const before = planShipmentAlerts(ship('2026-08-16'), rules).find((x) => x.kind === 'TAX_FUNDING')!;
    const after = planShipmentAlerts(ship('2026-08-17'), rules).find((x) => x.kind === 'TAX_FUNDING')!;
    const now = new Date('2026-08-01');
    expect(reconcileAlert({ dueAt: before.dueAt, status: 'SCHEDULED', title: before.title }, after, now)).toEqual({ action: 'update', status: 'SCHEDULED', resetNotified: true });
    expect(reconcileAlert({ dueAt: after.dueAt, status: 'SCHEDULED', title: after.title }, after, now).action).toBe('none');
    expect(reconcileAlert(null, after, new Date('2026-08-05')).status).toBe('DUE');
  });
  it('an invoice is due on its due date until paid; rules are validated', () => {
    const a = planInvoiceAlert({ id: 'g1', number: '20260818', customerName: 'Kato', dueDate: new Date('2026-08-25'), total: 176050.94, paid: 0, currency: 'USD', orderId: 'o1', shipmentId: null })!;
    expect(a.dueAt.toISOString().slice(0, 10)).toBe('2026-08-25');
    expect(a.resolved).toBe(false);
    expect(() => cleanAlertRules({ stuckDays: -1 }, fail)).toThrow('stuckDays');
    expect(cleanAlertRules({ digestHourJst: 8, digestEnabled: false }, fail)).toEqual({ digestHourJst: 8, digestEnabled: false });
  });
});

describe('pipeline grid and margin', () => {
  it('per delivery month, a column per order, a row per step: done / in progress / N/A / overdue', () => {
    const st = (displayNo: string, status: string, recordId: string, na = false) => ({ displayNo, code: displayNo, title: `Step ${displayNo}`, status, notApplicable: na, isOngoing: false, recordId });
    const g = pipelineGrid([
      { id: 'o11', label: '#11', deliveryMonth: '2026-09', customerName: 'SUS', status: 'OPEN', overdueRecords: new Set(['s1']), steps: [st('0', 'DONE', 'so1'), st('2', 'DONE', 'o11'), st('3a', 'DONE', 's1'), st('3b', 'IN_PROGRESS', 's1'), st('3b', 'DONE', 's2')] },
      { id: 'o20', label: '#20', deliveryMonth: '2026-11', customerName: 'Kato', status: 'OPEN', overdueRecords: new Set(), steps: [st('2', 'NOT_STARTED', 'o20', true), st('3a', 'IN_PROGRESS', 's3')] },
    ]);
    expect(g.months.map((m) => m.month)).toEqual(['2026-09', '2026-11']);
    const c11 = g.months[0].orders[0].cells;
    expect(c11['0']).toBe('done');
    expect(c11['3b']).toBe('overdue');
    expect(c11['4']).toBe('none');
    const c20 = g.months[1].orders[0].cells;
    expect(c20['2']).toBe('na');
    expect(c20['3a']).toBe('in_progress');
    expect(cellState([], new Set())).toBe('none');
  });
  it('margin per order from the contract schedule (MJP cancels out): SUS 6063 25 × 300 = 7,500; SUS 6005 (38 + 10 upcharge? no — 190 + 10 − 162)', () => {
    const sched = [{ from: '2026-06', to: null, supplierPremium: 205, clientPremium: 230, upcharge: null }];
    expect(orderMargin({ clientPremium: 230, supplierPremium: 556.5, qtyMt: 300 }, marginAt(sched, '2026-07'))).toBe(7500);
    const s6005 = [{ from: '2026-06', to: null, supplierPremium: 162, clientPremium: 190, upcharge: 10 }];
    expect(orderMargin({ clientPremium: 190, supplierPremium: 513.5, upcharge: 10, qtyMt: 120 }, marginAt(s6005, '2026-07'))).toBe(38 * 120);
    expect(cashByMonth([{ direction: 'OUT', paidAt: new Date('2026-07-24'), currency: 'USD', amount: 1247670.64 }])).toEqual({ '2026-07': { in: {}, out: { USD: 1247670.64 } } });
  });
});

describe('contract master and price check — 454003422 (SUS 6063: LME + QMJP + 230 to SUS; QMJP + 205 from Vedanta)', () => {
  const schedule = cleanPremiumSchedule([{ from: '2026-06', to: null, supplierPremium: 205, clientPremium: 230, upcharge: null }], fail);
  const prices = { lmeByMonth: { '2026-06': 3458.64, '2026-07': 3155.98 }, qmjpByQuarter: { '2026-2Q': 351.5, '2026-3Q': 395 } };
  it('schedule rules: months, no overlap; premium and margin of a month', () => {
    expect(() => cleanPremiumSchedule([{ from: '2026-01', to: '2026-06' }, { from: '2026-06', to: null }], fail)).toThrow('overlap');
    expect(premiumAt(schedule, '2026-09')).toMatchObject({ clientPremium: 230 });
    expect(marginAt(schedule, '2026-09')).toBe(25);
    expect(quarterOf('2026-07')).toBe('2026-3Q');
  });
  it('Invoice #2 (July): 3,155.98 + 395 + 230 = 3,780.98 — all ✓', () => {
    const c = priceCheck({ side: 'client', basisMonth: '2026-07', schedule, prices, found: { lme: 3155.98, qmjp: 395, premium: 230, unit: 3780.98 } });
    expect(c.ok).toBe(true);
    expect(c.lines.find((l) => l.key === 'unit')).toMatchObject({ expected: 3780.98, mark: 'ok' });
  });
  it('a wrong premium on the invoice is ✗ with the difference; nothing is changed', () => {
    const c = priceCheck({ side: 'client', basisMonth: '2026-07', schedule, prices, found: { lme: 3155.98, qmjp: 395, premium: 225, unit: 3775.98 } });
    expect(c.ok).toBe(false);
    expect(c.lines.find((l) => l.key === 'premium')).toMatchObject({ expected: 230, found: 225, diff: -5, mark: 'diff' });
  });
  it('PI 9331004128 (June basis, provisional): premium 556.50 = 2QMJP 351.5 + 205 ✓; its LME 3,475.45 vs the June average 3,458.64 ✗ +16.81', () => {
    const c = priceCheck({ side: 'supplier', mjpBased: true, basisMonth: '2026-06', schedule, prices, found: { premium: 556.5, lme: 3475.45, unit: 4031.95 } });
    expect(c.lines.find((l) => l.key === 'premium')).toMatchObject({ expected: 556.5, mark: 'ok' });
    expect(c.lines.find((l) => l.key === 'lme')).toMatchObject({ expected: 3458.64, diff: 16.81, mark: 'diff' });
    expect(c.lines.find((l) => l.key === 'unit')).toMatchObject({ expected: 4015.14, diff: 16.81 });
  });
  it('an unknown month is "unknown", never wrong', () => {
    const c = priceCheck({ side: 'client', basisMonth: '2026-12', schedule, prices, found: { premium: 230, unit: 3800 } });
    expect(c.lines.find((l) => l.key === 'lme')!.mark).toBe('unknown');
    expect(c.notes.join(' ')).toMatch('No LME average stored for 2026-12');
  });
});

describe('supplier orders and profiles', () => {
  it('label, doc ref and month arithmetic', () => {
    expect(supplierOrderLabel({ soNo: 3, piNo: '9331004128' })).toBe('PI 9331004128');
    expect(supplierOrderLabel({ soNo: 3, piNo: null })).toBe('S3');
    expect(supplierOrderDocRefBase({ year: 2026, soNo: 3 }, 'PI')).toBe('26-S3-PI');
    expect(addMonths('2026-07', 2)).toBe('2026-09');
    expect(addMonths('2026-12', 2)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
  it('no PI (Inalum / the Thai supplier): step 1 N/A and step 6 pays the CI in full; own document set on 3b', () => {
    const inalum = { ...defaultSupplierProfile('x'), hasPI: false, shippingDocs: ['BL', 'CI', 'PL'] };
    const p = profileFor(null, null);
    expect(naStepCodes(p, 'SUPPLIER_ORDER', inalum)).toEqual(['PI_PAYMENT']);
    expect(naStepCodes(p, 'SUPPLIER_ORDER', defaultSupplierProfile('v'))).toEqual([]);
    expect(stepOverride(p, 'CI_PAYMENT', inalum).title).toMatch('full amount');
    expect(stepOverride(p, 'SHIPPING_DOCS', inalum).requiredDocTypes).toEqual(['BL', 'CI', 'PL']);
    const merged = mergeSupplierProfiles({}, { '11111111-1111-1111-1111-111111111111': { hasPI: false, emailDomains: ['@Inalum.co.id'] } }, fail);
    expect(merged['11111111-1111-1111-1111-111111111111']).toMatchObject({ hasPI: false, emailDomains: ['inalum.co.id'] });
  });
});

describe('carriers, folder names, stock', () => {
  it('carrier from the B/L prefix / shipping line; Maersk / MSC links take the B/L', () => {
    expect(carrierOf('198GX04630')).toMatchObject({ code: 'WANHAI', prefilled: false });
    expect(carrierOf('MEDUAB123456')).toMatchObject({ code: 'MSC', prefilled: true });
    expect(carrierOf('MEDUAB123456')!.url).toContain('trackingNumber=MEDUAB123456');
    expect(carrierOf('263548901')).toMatchObject({ code: 'MAERSK', url: 'https://www.maersk.com/tracking/263548901' });
    expect(carrierOf('KMTCJKT1234567')!.code).toBe('KMTC');
    expect(carrierOf('SITGSHJK123456')!.code).toBe('SITC');
    expect(carrierOf('GGVC12345678')!.code).toBe('RCL');
    expect(carrierOf('X', 'EVERGREEN LINE')!.code).toBe('EVERGREEN');
    expect(carrierOf('ABC')).toBeNull();
  });
  it('folder: 6063-8inch_Sep_198GX04630_305.804_Yokohama_454003422', () => {
    const name = shipmentFolderName({ grade: '6063', size: '203 MM X 5800 MM', deliveryMonth: '2026-09', blNumber: '198GX04630', netWeightMt: 305.804, portOfDischarge: 'YOKOHAMA, JAPAN', contractNo: '454003422' });
    expect(name).toBe('6063-8inch_Sep_198GX04630_305.804_Yokohama_454003422');
    expect(diameterOf('8 inch')).toBe('8inch');
    expect(diameterOf(null)).toBeNull();
    expect(folderFileNames(name, [{ docRef: '26-11-1-BL', docType: 'BL', fileName: 'x.pdf' }, { docRef: null, docType: 'COA', fileName: 'a.XLS' }, { docRef: null, docType: 'COA', fileName: 'b.pdf' }])).toEqual([
      `${name}_26-11-1-BL.pdf`,
      `${name}_COA.xls`,
      `${name}_COA-2.pdf`,
    ]);
  });
  it('stock: in − delivered; storage periods (期) by half-month', () => {
    expect(storagePeriods('2026-12-01', '2026-12-15')).toBe(1);
    expect(storagePeriods('2026-12-01', '2026-12-16')).toBe(2);
    expect(storagePeriods('2026-12-10', '2027-03-01')).toBe(7);
    expect(deliveredBundles([{ bundles: 16, delivered: true }, { bundles: 16, delivered: false }, { bundles: '8', delivered: true }])).toBe(24);
    const l = stockLine(
      { id: 's', ref: '#11-1', blNumber: '198GX04630', customerName: 'SUS', warehouse: null, port: 'Yokohama', totalBundles: 120, netWeightMt: 305.804, storageStartDate: new Date('2026-12-01'), siRows: [[{ bundles: 40, delivered: true }]] },
      '2027-01-20',
      200,
    );
    expect(l).toMatchObject({ warehouse: 'Mitsui Soko Yokohama', bundlesInStock: 80, netMtInStock: 203.869, periods: 4, storageFeeEstimate: Math.round(4 * 203.869 * 200) });
  });
});

describe('email intake: known senders and the declaration', () => {
  it('Wan Hai "(WEB)ARRIVAL NOTICE <BL>" → that B/L\'s A/N', () => {
    const hit = knownSender({ from: 'Y S Agency <noreply@wanhai.com>', subject: '(WEB)ARRIVAL NOTICE 198GX04630 RACHA BHUM 211E', attachments: [{ name: 'WDMFT505_AN.pdf' }] })!;
    expect(hit).toMatchObject({ rule: 'WANHAI_AN', blNo: '198GX04630', attachmentTypes: { 'WDMFT505_AN.pdf': 'ARRIVAL_NOTICE' } });
  });
  it('Mitsui Soko NO.取りリスト → bundle list; 輸入許可書 → import permit', () => {
    expect(knownSender({ from: 'x@mitsui-soko.co.jp', subject: 'NO.取りリスト 198GX04630', attachments: [{ name: 'list.csv' }] })).toMatchObject({ rule: 'MITSUI_BUNDLE_LIST', attachmentTypes: { 'list.csv': 'BUNDLE_LIST' } });
    expect(knownSender({ from: 'x@mitsui-soko.co.jp', subject: 'FW: 書類', attachments: [{ name: '輸入許可書202607-09_JPY18,386,700_SUS305.804t.pdf' }, { name: 'other.pdf' }] })!.attachmentTypes).toEqual({ '輸入許可書202607-09_JPY18,386,700_SUS305.804t.pdf': 'IMPORT_PERMIT' });
    expect(knownSender({ from: 'a@b.com', subject: 'hello', attachments: [] })).toBeNull();
  });
  it('Vedanta "ADH | Aug\'26 declaration": the PI table → supplier-order rows', () => {
    expect(knownSender({ from: 'sales@vedanta.co.in', subject: "RE: ADH | Aug'26 declaration", attachments: [{ name: 'PI 9331004202.pdf' }] })!.rule).toBe('VEDANTA_DECLARATION');
    const body = [
      'Grade\tContract\tCustomer\tDestination\tQty\tQP\tProvisional Price/MT\tPI no.',
      "6063\t454003422\tSUS\tYokohama\t300\tAverage LME of MOSS (Aug'26)\t3,980.50\t9331004210",
      "6005\t454003255\tSUS\tYokohama\t120\tAverage LME of MOSS (Aug'26)\t3,937.50\t9331004211",
      'Regards',
    ].join('\n');
    const rows = parseDeclarationTable(body);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ grade: '6063', contractNo: '454003422', customer: 'SUS', destination: 'Yokohama', qtyMt: 300, pricePerMt: 3980.5, piNo: '9331004210' });
    expect(declarationMonthOf(rows[0].qpBasis)).toBe('2026-08');
  });
});
