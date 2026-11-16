/**
 * Round BU (Sayaka, 2026-11-16) — the CI's payable amount is the boxed TOTAL (Sub Total − Trade Discount − Advance),
 * not the Sub Total. Fixture: #25-1's CI XP2652102958 (text layer; bank block and contact lines left out).
 */
import { advanceMismatch, aimsDepositOf, ciAmountOf, ciBalanceOf, ciPayableOf, ciVersionOf, CiVersion, parseCiText } from './trade-ci';
import { advanceFlag } from './trade-unpaid.service';
import { CI_SCHEMA, CI_USER_PROMPT } from './trade-extract.rules';
import { ciRawFromText } from './trade-extract.service';
import { TradeUnpaidService } from './trade-unpaid.service';

const CI_25_1 = `FINAL COMMERCIAL INVOICE
VEDANTA ALUMINIUM METAL LIMITED
VEDANTA ALUMINIUM METAL LIMITED – SEZ UNIT,, BURKHAMUNDA,
BRUNDAMAL, KUREBAGA, JHARSUGUDA,JHARSUGUDA, JHARSUGUDA,
ODISHA-768202, INDIA
Works : AAJCV6954AIEC Code:
Producer :
Applicant/Buyer :
ASIA DEAL HUB PTE. LTD.
Consignee :
ASIA DEAL HUB JAPAN LLC.
XP2652102958Invoice No. :
31/10/2026Invoice Date :
102.479Qty Gross(MT)
102.079Qty Net(MT)
40No. of Bundles
YOKOHAMA, JAPAN
Port of Discharge
198GX07112BL No.
31/10/2026BL Date
CIF YOKOHAMA, JAPANIncoTerms
Description of Goods Quantity
Net(MT)
LME
(US$/MT)
PREMIUM
(US$/MT) Rate/MT(US$) Amount (US$)
ALUMINIUM BILLET ALLOY 6005 203 MM X 5800 MM
COUNTRY OF ORIGIN : INDIA
HS CODE : 7601.20
102.079 3,061.11 417.00 3,478.11 355,041.99
355,041.99Sub Total
0Trade Discount(US$)
38,570.40Advance(US$)
PRICE IS FINAL 102.079TOTAL 316,471.59
CERTIFIED TO BE TRUE AND CORRECT
CERTIFIED THAT THE MERCHANDISE ARE OF INDIAN ORIGIN
FOR VEDANTA ALUMINIUM METAL LIMITED
AUTHORISED SIGNATORY
354,239.01FOB Value
775.00Freight
27.98Insurance
Regd. Off. :`;

// #19-1's REVISED CI: the advance left blank, TOTAL = Sub Total.
const CI_NO_ADVANCE = CI_25_1.replace('38,570.40Advance(US$)', 'Advance(US$)').replace('TOTAL 316,471.59', 'TOTAL 355,041.99');

describe('Round BU — the CI reader: Sub Total, Trade Discount, Advance, TOTAL, FOB / Freight / Insurance', () => {
  it('#25-1 CI XP2652102958: every amount of the totals block and the foot', () => {
    const c = parseCiText(CI_25_1);
    expect(c).toMatchObject({
      ciNumber: 'XP2652102958',
      ciDate: '2026-10-31',
      status: 'FINAL',
      subTotal: 355041.99,
      tradeDiscount: 0,
      advance: 38570.4,
      total: 316471.59,
      fobValue: 354239.01,
      freight: 775,
      insurance: 27.98,
      netMt: 102.079,
      lme: 3061.11,
      premium: 417,
      rate: 3478.11,
    });
    // The CI amount stays the Sub Total (price check, CI versions); the payable is the TOTAL.
    expect(ciAmountOf(c)).toBe(355041.99);
    expect(ciPayableOf(c)).toBe(316471.59);
    // FOB + Freight + Insurance = the CIF the Sub Total is.
    expect(Math.round((c.fobValue! + c.freight! + c.insurance!) * 100) / 100).toBe(c.subTotal);
  });
  it('PROVISIONAL is read from "PRICE IS PROVISIONAL" too', () => {
    expect(parseCiText(CI_25_1.replace('FINAL COMMERCIAL INVOICE\n', '').replace('PRICE IS FINAL', 'PRICE IS PROVISIONAL')).status).toBe('PROVISIONAL');
  });
  it('an advance left blank: no advance, TOTAL = Sub Total', () => {
    const c = parseCiText(CI_NO_ADVANCE);
    expect(c.advance).toBeNull();
    expect(c.total).toBe(355041.99);
    expect(ciPayableOf(c)).toBe(355041.99);
  });
  it('payable: TOTAL when read; Sub Total − discount − advance when only TOTAL is missing; never without a Sub Total', () => {
    expect(ciPayableOf({ subTotal: 100, tradeDiscount: 5, advance: 10, total: null })).toBe(85);
    expect(ciPayableOf({ subTotal: 100, advance: null, total: null })).toBeNull();
    // An old AI read with one amount: unknown whether it is before or after the advance.
    expect(ciPayableOf({ subTotal: null, total: 316471.59 })).toBeNull();
  });
  it('the stored read carries the new fields; the AI schema / prompt take them too', () => {
    const raw = ciRawFromText(parseCiText(CI_25_1));
    expect(raw).toMatchObject({ subTotal: 355041.99, tradeDiscount: 0, advance: 38570.4, totalAmount: 316471.59, fobValue: 354239.01, freight: 775, insurance: 27.98, status: 'FINAL' });
    expect(CI_SCHEMA.parse({ subTotal: 1, tradeDiscount: 0, fobValue: 2, freight: 3, insurance: 4 })).toMatchObject({ tradeDiscount: 0, fobValue: 2, freight: 3, insurance: 4 });
    for (const k of ['tradeDiscount', 'fobValue', 'freight', 'insurance']) expect(CI_USER_PROMPT).toContain(`"${k}"`);
  });
});

describe('Round BU — step 6 balance payable', () => {
  const file = { id: 'f1', fileName: 'COMMERCIAL_INVOICE_9000600228.pdf', createdAt: '2026-11-01T00:00:00Z' };
  const v25 = ciVersionOf(ciRawFromText(parseCiText(CI_25_1)), file);
  it('the version whose Sub Total is the stored CI amount gives the TOTAL and the advance', () => {
    expect(v25).toMatchObject({ amount: 355041.99, payable: 316471.59, advance: 38570.4, tradeDiscount: 0 });
    expect(ciBalanceOf(355041.99, [v25])).toEqual({ ciNumber: 'XP2652102958', amount: 355041.99, payable: 316471.59, advance: 38570.4, tradeDiscount: 0, fileId: 'f1' });
    // Nothing stored yet: the latest version.
    expect(ciBalanceOf(null, [v25])?.payable).toBe(316471.59);
  });
  it('a stored amount no version has (typed by hand / a newer version not applied): no balance from the CI', () => {
    expect(ciBalanceOf(350000, [v25])).toBeNull();
  });
  it('older stored versions follow the stored amount, not the newest file', () => {
    const prov: CiVersion = { ...v25, fileId: 'f0', status: 'PROVISIONAL', amount: 360000, payable: 321429.6, advance: 38570.4 };
    expect(ciBalanceOf(360000, [prov, v25])?.fileId).toBe('f0');
    expect(ciBalanceOf(355041.99, [prov, v25])?.fileId).toBe('f1');
  });
  it('an old AI read (one amount, no Sub Total): no balance — the step falls back to the CI amount', () => {
    const old = ciVersionOf({ ciNumber: 'XP1', totalAmount: 128088.17 }, file);
    expect(old.amount).toBe(128088.17);
    expect(ciBalanceOf(128088.17, [old])).toBeNull();
  });
});

describe('Round BU — the CI Advance vs the deposit AIMS has', () => {
  it('the order deposit, else PI × %, else the supplier order PI when it buys for this order alone', () => {
    expect(aimsDepositOf({ depositAmount: '38570.4' })).toEqual({ amount: 38570.4, source: 'order' });
    expect(aimsDepositOf({ piAmount: 156672, depositPct: 10 })).toEqual({ amount: 15667.2, source: 'order' });
    expect(aimsDepositOf({}, { depositAmount: 40440, _count: { customerOrders: 1 } })).toEqual({ amount: 40440, source: 'supplierOrder' });
    expect(aimsDepositOf({}, { depositAmount: 40440, _count: { customerOrders: 2 } })).toBeNull();
    expect(aimsDepositOf({})).toBeNull();
  });
  it('flags a different advance; equal, split-and-adding-up and nothing-to-compare are fine', () => {
    expect(advanceMismatch(38570.4, 38570.4, { first: true })).toBeNull();
    expect(advanceMismatch(43774.56, 15667.2, { first: true })).toBe('CI advance 43,774.56 ≠ AIMS deposit 15,667.20');
    expect(advanceMismatch(12492.4, 12540.16, { first: true })).toBe('CI advance 12,492.40 ≠ AIMS deposit 12,540.16');
    expect(advanceMismatch(20000, 40000, { first: true, orderAdvances: 40000 })).toBeNull();
    expect(advanceMismatch(0, 40000, { first: false })).toBeNull();
    expect(advanceMismatch(null, 40000, { first: true })).toBeNull();
    expect(advanceMismatch(0, 40000, { first: true })).toBe('CI advance 0.00 ≠ AIMS deposit 40,000.00');
    expect(advanceMismatch(38570.4, null, { first: true })).toBeNull();
  });
  it('advanceFlag sums the advances over the order’s shipments', () => {
    const reads = new Map<string, CiVersion[]>([
      ['s1', [{ fileId: 'a', fileName: 'a', uploadedAt: '', ciNumber: 'XP1', ciDate: null, status: 'FINAL', amount: 200000, payable: 180000, advance: 20000 }]],
      ['s2', [{ fileId: 'b', fileName: 'b', uploadedAt: '', ciNumber: 'XP2', ciDate: null, status: 'FINAL', amount: 200000, payable: 180000, advance: 20000 }]],
    ]);
    const o = { depositAmount: 40000, shipments: [{ id: 's1' }, { id: 's2' }] };
    expect(advanceFlag(o, 's1', true, 20000, reads)).toBeNull();
    expect(advanceFlag({ ...o, depositAmount: 38000 }, 's1', true, 20000, reads)).toBe('CI advance 20,000.00 ≠ AIMS deposit 38,000.00');
  });
});

describe('Round BU — Dashboard Unpaid: the CI row is the CI’s TOTAL', () => {
  const ciRead = { fileId: 'f1', result: { raw: ciRawFromText(parseCiText(CI_25_1)) }, file: { id: 'f1', fileName: 'CI.pdf', createdAt: new Date('2026-11-01'), links: [{ shipmentId: 's1' }] } };
  const step = (depositAmount: number) => ({
    id: 'st6',
    code: 'CI_PAYMENT',
    status: 'TODO',
    payment: null,
    order: null,
    shipment: {
      id: 's1',
      seqNo: 1,
      ciNumber: 'XP2652102958',
      ciAmount: 355041.99,
      currency: 'USD',
      costs: {},
      fileLinks: [],
      steps: [],
      order: { id: 'o25', orderNo: 25, depositAmount, piAmount: null, depositPct: 10, depositPaidAt: null, supplier: { name: 'Vedanta' }, supplierOrder: null, steps: [{ status: 'DONE', payment: null }], shipments: [{ id: 's1' }] },
    },
  });
  const run = async (depositAmount: number, reads: any[] = [ciRead]) => {
    const prisma: any = new Proxy(
      {},
      {
        get: (_t, model: string) => ({
          findMany: jest.fn(async () => (model === 'tradeStep' ? [step(depositAmount)] : model === 'tradeExtraction' ? reads : [])),
          findFirst: jest.fn(async () => null),
          count: jest.fn(async () => 0),
        }),
      },
    );
    const svc = new TradeUnpaidService(prisma, { openItems: jest.fn(async () => []) } as any, {} as any);
    const list: any = await svc.list('org', '2026-11-16').catch((e: Error) => ({ error: e.message }));
    return list;
  };
  it('#25-1: USD 316,471.59 (the TOTAL), no flag when the deposit is the advance', async () => {
    const l = await run(38570.4);
    expect(l.error).toBeUndefined();
    const r = l.pay.find((x: any) => x.kind === 'CI');
    expect(r).toMatchObject({ amount: 316471.59, documentNo: 'CI XP2652102958', note: 'CI TOTAL (Sub Total 355,041.99 − advance 38,570.40)' });
    expect(r.flag ?? null).toBeNull();
  });
  it('flagged when the advance is not the deposit AIMS has', async () => {
    const r = (await run(38000)).pay.find((x: any) => x.kind === 'CI');
    expect(r.amount).toBe(316471.59);
    expect(r.flag).toBe('CI advance 38,570.40 ≠ AIMS deposit 38,000.00');
  });
  it('no CI read: CI amount − deposit paid (round BQ)', async () => {
    const r = (await run(38570.4, [])).pay.find((x: any) => x.kind === 'CI');
    expect(r.amount).toBe(316471.59);
    expect(r.note).toBe('CI 355,041.99 − deposit paid 38,570.40');
  });
});
