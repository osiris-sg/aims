/** Round AG — the Monthly order list in ADH's layout: blocks per client, rows per shipment, statuses, months, exports. */
import * as ExcelJS from 'exceljs';
import { buildMonthlyList, cleanMonths, defaultMonths, HEADERS, monthlyCsv, monthlySummary, OrderFact, orderDateOf, rowCells, shipmentStatus, supplierStatus } from './monthly-list';
import { monthlyXlsx } from './monthly-list.xlsx';

const step = (code: string, status: string) => ({ code, status, notApplicable: false });
const ship = (seqNo: number, o: Partial<OrderFact['shipments'][number]> = {}): OrderFact['shipments'][number] => ({ id: `s${seqNo}`, seqNo, status: 'OPEN', blNumber: `198GX0${seqNo}000`, etd: '2026-09-30', eta: '2026-10-29', deliveryMonth: null, currentStep: { id: `st${seqNo}`, label: '9. Send arrival notice', code: 'AN' }, ciPayment: [step('CI_PAYMENT', 'NOT_STARTED')], ...o });
const order = (o: Partial<OrderFact>): OrderFact => ({ id: `o${o.orderNo}`, orderNo: 1, status: 'OPEN', checkFields: [], customerId: 'c-sus', customerName: 'SUS Co., Ltd.', customerPoNo: null, customerKey: 'SUS', supplierName: 'Vedanta Limited', customerPoDate: '2026-08-01', grade: '6005', size: '203 MM X 5800 MM', qtyMt: 220, shipMonth: '2026-09', deliveryMonth: '2026-11', supplierContractNo: '454003598', piDate: '2026-07-14', piQtyMt: 220, supplierDone: false, piPayment: [step('PI_PAYMENT', 'DONE')], currentStepId: 'ost', shipments: [], ...o });
const W = { from: '2026-10', to: '2026-12', basis: 'delivery' as const, today: '2026-10-26' };

describe('Monthly order list', () => {
  const orders = [
    order({ orderNo: 18, shipments: [ship(1), ship(2), ship(3)] }),
    order({ orderNo: 21, customerId: 'c-kato', customerName: '加藤軽金属株式会社', customerKey: 'KATO', grade: '6063', size: 'HSB', qtyMt: 32, shipments: [ship(1, { ciPayment: [step('CI_PAYMENT', 'DONE')] })] }),
    order({ orderNo: 30, customerId: 'c-siae', customerName: 'Sanyo Trading', customerKey: null, supplierName: 'PT Sri Indah Aluminium Extrusion', checkFields: ['status'], piPayment: [step('PI_PAYMENT', 'NOT_STARTED')], deliveryMonth: '2026-12', shipments: [] }),
    order({ orderNo: 12, deliveryMonth: '2026-09', shipments: [ship(1)] }), // outside the window
    order({ orderNo: 14, customerId: 'c-hoei', customerName: 'Hoei', customerKey: 'HOEI', status: 'COMPLETED', supplierDone: true, deliveryMonth: '2026-10', shipments: [ship(1, { status: 'COMPLETED', currentStep: null })] }),
  ];
  const blocks = buildMonthlyList(orders, W);

  it('blocks in the order Kato, SUS, Hoei, then the others; one row per shipment; merged order cells', () => {
    expect(blocks.map((b) => b.client)).toEqual(['Kato', 'SUS', 'Hoei', 'Sanyo Trading']);
    const sus = blocks[1];
    expect(sus.rows.map((r) => r.shipmentRef)).toEqual(['#18-1', '#18-2', '#18-3']);
    expect(sus.rows.map((r) => r.first)).toEqual([true, false, false]);
    expect(sus.rows[0].span).toBe(3);
    // Order / supplier cells on the first row only; the two Status columns (8, 12) are each row's own (round AM).
    expect(rowCells(sus.rows[1]).slice(0, 13).filter((x, i) => x !== null && i !== 8 && i !== 12)).toEqual([]);
    expect(rowCells(sus.rows[1])[8]).toBe('In transit');
    // 管理NO = ADH's client-order number per shipment; Order No. = #n (or the customer's PO no. when AIMS has it).
    expect(sus.rows.map((r) => r.managementNo)).toEqual(['#18-1', '#18-2', '#18-3']);
    expect(rowCells(sus.rows[1])[13]).toBe('#18-2');
    expect(sus.rows[0].orderNo).toBe('#18');
    expect(buildMonthlyList([order({ orderNo: 18, customerPoNo: 'PO-7781', shipments: [ship(1)] })], W)[0].rows[0]).toMatchObject({ orderNo: 'PO-7781', managementNo: '#18-1' });
    expect(sus.orders).toBe(1);
    expect(sus.tons).toBe(220);
  });
  it('an order with no shipment yet is one row with empty shipment cells; outside-window orders are left out', () => {
    const r = blocks[3].rows;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ orderNo: '#30', managementNo: '#30', shipmentRef: null, blNumber: null, shipmentStatus: null, orderStatus: 'Unconfirmed', supplier: 'SIAE', supplierStatus: 'PI open', stepId: 'ost' });
    expect(blocks.flatMap((b) => b.rows).some((x) => x.orderNo === '#12')).toBe(false);
  });
  it('statuses: order Open / Completed / Unconfirmed; supplier PI open → PI paid → CI paid → Done; shipment = current step or Delivered', () => {
    expect(blocks[0].rows[0]).toMatchObject({ orderStatus: 'Open', supplierStatus: 'CI paid', billetType: '6063 HSB', supplier: 'Vedanta' });
    expect(blocks[1].rows[0].supplierStatus).toBe('PI paid');
    expect(blocks[2].rows[0]).toMatchObject({ orderStatus: 'Completed', supplierStatus: 'Done', shipmentStatus: 'Delivered' });
    expect(supplierStatus({ supplierDone: false, piPayment: [], shipments: [ship(1, { ciPayment: [step('CI_PAYMENT', 'DONE')] }), ship(2)] })).toBe('CI paid 1/2');
    expect(shipmentStatus(ship(1))).toBe('9. Send arrival notice');
  });
  it('filters: client, supplier, grade, status, ship-month basis; the default window = this month + the next two', () => {
    expect(buildMonthlyList(orders, { ...W, customerId: 'c-kato' }).map((b) => b.client)).toEqual(['Kato']);
    expect(buildMonthlyList(orders, { ...W, supplier: 'SIAE' }).map((b) => b.client)).toEqual(['Sanyo Trading']);
    expect(buildMonthlyList(orders, { ...W, grade: '6063' }).map((b) => b.client)).toEqual(['Kato']);
    expect(buildMonthlyList(orders, { ...W, status: 'Completed' }).map((b) => b.client)).toEqual(['Hoei']);
    expect(buildMonthlyList(orders, { from: '2026-09', to: '2026-09', basis: 'ship' }).flatMap((b) => b.rows).length).toBeGreaterThan(0);
    expect(defaultMonths('2026-10-24')).toEqual({ from: '2026-10', to: '2026-12' });
    expect(cleanMonths('2026-12', '2026-10', '2026-10-24')).toEqual({ from: '2026-10', to: '2026-12' });
    expect(cleanMonths('bad', null, '2026-10-24')).toEqual({ from: '2026-10', to: '2026-12' });
    // A shipment's own delivery month wins over the order's.
    const moved = [order({ orderNo: 40, deliveryMonth: '2026-11', shipments: [ship(1), ship(2, { deliveryMonth: '2027-01' })] })];
    expect(buildMonthlyList(moved, W)[0].rows.map((r) => r.shipmentRef)).toEqual(['#40-1']);
  });
  it('CSV in their layout: group row, header row, a title row per client (UTF-8 BOM)', () => {
    const csv = monthlyCsv(blocks).split('\r\n');
    expect(csv[0].startsWith('﻿Order information,')).toBe(true);
    expect(csv[1].split(',')).toEqual([...HEADERS]);
    expect(csv[2]).toBe('Kato');
  });
  it('xlsx in their layout: title, 3 merged groups, headers, yellow status columns, merged order cells', async () => {
    const buf = await monthlyXlsx(blocks, { orgName: 'ADH', from: '2026-10', to: '2026-12', basis: 'delivery', generatedAt: new Date('2026-10-24T00:00:00Z') });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A2').value).toBe('Order information');
    expect(ws.getCell('J2').value).toBe('Supplier information');
    expect(ws.getCell('N2').value).toBe('Shipment information');
    expect(ws.getRow(3).values).toEqual([undefined, ...HEADERS]);
    expect((ws.getCell('I3').fill as any).fgColor.argb).toBe('FFFFFF00');
    expect((ws.getCell('M3').fill as any).fgColor.argb).toBe('FFFFFF00');
    expect(String(ws.getCell('A4').value)).toMatch(/^Kato/);
    // SUS block: title row, then #18 merged over its 3 rows, 管理NO #18-1..3.
    const susTitle = [...Array(ws.rowCount).keys()].map((i) => i + 1).find((n) => String(ws.getCell(`A${n}`).value).startsWith('SUS'))!;
    expect(ws.getCell(`B${susTitle + 1}`).value).toBe('#18');
    expect(ws.getCell(`B${susTitle + 3}`).isMerged).toBe(true);
    expect(ws.getCell(`N${susTitle + 1}`).value).toBe('#18-1');
    expect(ws.getCell(`N${susTitle + 3}`).value).toBe('#18-3');
    expect(ws.getCell(`A${susTitle + 3}`).isMerged).toBe(true);
    // Round AM: the Status columns are per row (not merged); Notes is the last column.
    expect(ws.getCell(`I${susTitle + 3}`).isMerged).toBe(false);
    expect(ws.getCell('R3').value).toBe('Notes');
  });
  it('customer Order Date = customer PO date only, else blank (never the PI date, never the AIMS creation / import date)', () => {
    expect(orderDateOf({ customerPoDate: '2026-05-10' })).toBe('2026-05-10');
    expect(orderDateOf({ customerPoDate: null })).toBeNull();
    const withPi = buildMonthlyList([order({ orderNo: 51, customerPoDate: null, piDate: '2026-06-30', shipments: [ship(1)] })], W)[0].rows[0];
    expect(withPi).toMatchObject({ orderDate: null, supplierOrderDate: '2026-06-30' });
    const none = buildMonthlyList([order({ orderNo: 50, customerPoDate: null, piDate: null, shipments: [ship(1)] })], W)[0].rows[0];
    expect(none).toMatchObject({ orderDate: null, supplierOrderDate: null });
  });
  it('the WhatsApp summary', () => {
    const t = monthlySummary(blocks, W, 'en');
    expect(t.split('\n')[0]).toBe('Monthly order list Oct 2026 – Dec 2026 (delivery month): 4 orders · 692 t');
    expect(t).toContain('SUS: 1 order · 220 t (1 open)');
    expect(monthlySummary([], { ...W, from: '2026-11', to: '2026-11' }, 'en')).toBe('Monthly order list Nov 2026 (delivery month): no orders.');
  });
  it('round AM: plain Order / Supplier Status per row, the stage filter, Notes, supplier filter', () => {
    const o = order({ orderNo: 60, customerKey: 'SUS', supplierId: 'v1', piNo: '9331004321', orderSteps: [step('PI_PAYMENT', 'DONE'), step('INVOICE_1', 'DONE')], shipments: [
      ship(1, { etd: '2026-10-06', eta: '2026-11-01', notes: '11/9 2trks 40T', steps: [step('BL_DRAFT_APPROVAL', 'DONE'), step('SEND_DOCS_SCHEDULE', 'DONE')] }),
      ship(2, { blNumber: null, etd: null, steps: [] }),
    ] });
    const rows = buildMonthlyList([o], W)[0].rows;
    expect(rows.map((r) => [r.orderStageLabel, r.supplierStageLabel, r.notes])).toEqual([
      ['Docs sent, waiting for schedule', 'Shipped (B/L issued)', '11/9 2trks 40T'],
      ['Waiting for shipment', 'Deposit paid', null],
    ]);
    expect(rowCells(rows[0])[17]).toBe('11/9 2trks 40T');
    const only = buildMonthlyList([o], { ...W, stage: 'WAITING_SHIPMENT' })[0].rows;
    expect(only.map((r) => [r.managementNo, r.first, r.span])).toEqual([['#60-2', true, 1]]);
    expect(buildMonthlyList([o], { ...W, supplierId: 'other' })).toEqual([]);
    expect(buildMonthlyList([order({ orderNo: 61, checkFields: ['status'], shipments: [] })], W)[0].rows[0]).toMatchObject({ orderStage: 'WAITING_SHIPMENT', unconfirmed: true });
  });
  it('round AM: an order on two supplier orders (split declaration) — Order ton summed, both contract · PI listed', () => {
    const o = order({ orderNo: 23, qtyMt: 200, piQtyMt: 100, supplierContractNo: '454003255', piDate: null, supplierLines: [
      { contractNo: '454003255', piNo: '9331004319', piDate: null, qtyMt: 100 },
      { contractNo: '454003422', piNo: '9331004321', piDate: '2026-09-22', qtyMt: 100 },
    ], shipments: [] });
    const r = buildMonthlyList([o], W)[0].rows[0];
    expect(r).toMatchObject({ supplierTon: 200, supplierContractNo: '454003255 · PI 9331004319\n454003422 · PI 9331004321', supplierOrderDate: '2026-09-22' });
    // One supplier order: unchanged.
    expect(buildMonthlyList([order({ orderNo: 24, supplierLines: [{ contractNo: '454003422', piNo: 'x', piDate: null, qtyMt: 200 }], shipments: [] })], W)[0].rows[0]).toMatchObject({ supplierContractNo: '454003598', supplierTon: 220 });
  });
});

describe('Monthly order list — round AN shared header (tabs, Search, main Filter)', () => {
  const o16 = order({ orderNo: 16, contractIds: ['k1'], shipMonth: '2026-09', shipments: [ship(1, { blNumber: '198GX06516', vessel: 'WAN HAI 317' }), ship(2, { blNumber: '198GX06524' })] });
  const o21 = order({ orderNo: 21, customerId: 'c-kato', customerName: '加藤軽金属株式会社', customerKey: 'KATO', grade: '6063', contractIds: ['k2'], shipMonth: '2026-08', shipments: [ship(1, { blNumber: 'KMTC1' })] });
  const o14 = order({ orderNo: 14, status: 'COMPLETED', supplierDone: true, contractIds: ['k1'], shipments: [ship(1, { status: 'COMPLETED', currentStep: null })] });
  const all = [o16, o21, o14];
  const refs = (f: Partial<Parameters<typeof buildMonthlyList>[1]>) => buildMonthlyList(all, { ...W, ...f }).flatMap((b) => b.rows.map((r) => r.managementNo));

  it('Pending / Completed / All tabs', () => {
    expect(refs({ bucket: 'pending' })).toEqual(['#21-1', '#16-1', '#16-2']);
    expect(refs({ bucket: 'completed' })).toEqual(['#14-1']);
    expect(refs({ bucket: 'all' }).sort()).toEqual(['#14-1', '#16-1', '#16-2', '#21-1']);
  });
  it('Search: order no., a shipment ref, a B/L, a vessel, a customer, a grade', () => {
    expect(refs({ q: '#16' })).toEqual(['#16-1', '#16-2']);
    expect(refs({ q: '16-2' })).toEqual(['#16-2']);
    expect(refs({ q: '198GX06516' })).toEqual(['#16-1']);
    expect(refs({ q: 'wan hai' })).toEqual(['#16-1']);
    expect(refs({ q: 'kato' })).toEqual(['#21-1']);
    expect(refs({ q: '6063' })).toEqual(['#21-1']);
    expect(refs({ q: 'nothing' })).toEqual([]);
  });
  it('main Filter: contract and ship month', () => {
    expect(refs({ contractId: 'k1' }).sort()).toEqual(['#14-1', '#16-1', '#16-2']);
    expect(refs({ shipMonth: '2026-08' })).toEqual(['#21-1']);
    expect(refs({ shipMonth: 'none' })).toEqual([]);
  });
});
