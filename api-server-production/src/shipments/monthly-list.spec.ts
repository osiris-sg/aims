/** Round AG — the Monthly order list in ADH's layout: blocks per client, rows per shipment, statuses, months, exports. */
import * as ExcelJS from 'exceljs';
import { buildMonthlyList, cleanMonths, defaultMonths, HEADERS, monthlyCsv, monthlySummary, OrderFact, rowCells, shipmentStatus, supplierStatus } from './monthly-list';
import { monthlyXlsx } from './monthly-list.xlsx';

const step = (code: string, status: string) => ({ code, status, notApplicable: false });
const ship = (seqNo: number, o: Partial<OrderFact['shipments'][number]> = {}): OrderFact['shipments'][number] => ({ id: `s${seqNo}`, seqNo, status: 'OPEN', blNumber: `198GX0${seqNo}000`, etd: '2026-09-30', eta: '2026-10-29', deliveryMonth: null, currentStep: { id: `st${seqNo}`, label: '9. Send arrival notice', code: 'AN' }, ciPayment: [step('CI_PAYMENT', 'NOT_STARTED')], ...o });
const order = (o: Partial<OrderFact>): OrderFact => ({ id: `o${o.orderNo}`, orderNo: 1, status: 'OPEN', checkFields: [], customerId: 'c-sus', customerName: 'SUS Co., Ltd.', customerPoNo: null, customerKey: 'SUS', supplierName: 'Vedanta Limited', orderDate: '2026-08-01', grade: '6005', size: '203 MM X 5800 MM', qtyMt: 220, shipMonth: '2026-09', deliveryMonth: '2026-11', supplierContractNo: '454003598', piDate: '2026-07-14', piQtyMt: 220, supplierDone: false, piPayment: [step('PI_PAYMENT', 'DONE')], currentStepId: 'ost', shipments: [], ...o });
const W = { from: '2026-10', to: '2026-12', basis: 'delivery' as const };

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
    expect(rowCells(sus.rows[1]).slice(0, 13).filter((x) => x !== null)).toEqual([]); // order / supplier cells on the first row only
    // 管理NO = ADH's client-order number per shipment; Order No. = #n (or the customer's PO no. when AIMS has it).
    expect(sus.rows.map((r) => r.managementNo)).toEqual(['#18-1', '#18-2', '#18-3']);
    expect(rowCells(sus.rows[1])[14]).toBe('#18-2');
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
    expect(ws.getCell(`O${susTitle + 1}`).value).toBe('#18-1');
    expect(ws.getCell(`O${susTitle + 3}`).value).toBe('#18-3');
    expect(ws.getCell(`A${susTitle + 3}`).isMerged).toBe(true);
  });
  it('the WhatsApp summary', () => {
    const t = monthlySummary(blocks, W, 'en');
    expect(t.split('\n')[0]).toBe('Monthly order list Oct 2026 – Dec 2026 (delivery month): 4 orders · 692 t');
    expect(t).toContain('SUS: 1 order · 220 t (1 open)');
    expect(monthlySummary([], { ...W, from: '2026-11', to: '2026-11' }, 'en')).toBe('Monthly order list Nov 2026 (delivery month): no orders.');
  });
});
