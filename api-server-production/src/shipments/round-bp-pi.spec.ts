/**
 * Round BP — PI "Amount Payable" (the deposit) and "Instrument to be received by" (its due date), per order on a
 * shared PI (Vedanta 9331004393 for #30 / #31).
 */
import { parseVedantaPiText } from './trade-pi-text';
import { contractDraftFromPi, piLineForOrder } from './trade-extract.rules';
import { piFillFor } from './trade-extract.service';
import { dueOf } from './trade-due';

const PI_4393 = `VEDANTA ALUMINIUM METAL LIMITED
PROFORMA INVOICE
Buyer:
ASIA DEAL HUB PTE. LTD.
Port of Loading ANY
Port of Discharge YOKOHAMA, JAPAN
Payment 10% Adv with 5 business days
Instrument to be received by 06/11/2026
Contract No 454003422
Invoice No 9331004393
Date 03/11/2026
Terms of Delivery
CIF YOKOHAMA, JAPAN
Shipment Month November 2026
Description of Goods Quantity(MT) LME
(US$/MT)
PREMIUM
(US$/MT) Rate(US$/MT) Amount(US$) Amount
Payable(US$)
ALUMINIUM BILLET ALLOY 6005V26 -C 8" 100.000 3095.00 495.00 3590.00 359000.00 35900.00
ALUMINIUM BILLET ALLOY 6063V35 -C 8" 200.000 3095.00 460.00 3555.00 711000.00 71100.00
Total 300.000 1070000.00 107000.00
Tolerance Limit : +/-5.0% in quantity and +/- 5% in amount`;

const order = (p: Record<string, unknown> = {}) => ({ grade: '6005', qtyMt: 100, piNo: null, piDate: null, piAmount: null, depositPct: 10, depositAmount: null, depositDueDate: null, ...p }) as any;

describe('round BP — Vedanta PI text layer', () => {
  it('reads both amount columns per line, the payment term and the instrument date', () => {
    const { data, complete } = parseVedantaPiText(PI_4393);
    expect(complete).toBe(true);
    expect(data).toMatchObject({ piNumber: '9331004393', contractNo: '454003422', piDate: '2026-11-03', paymentTerms: '10% Adv with 5 business days', instrumentDueDate: '2026-11-06', shipmentMonth: '2026-11', totalAmount: 1070000, amountPayable: 107000 });
    expect(data.lines.map((l) => [l.grade, l.quantityMt, l.amount, l.amountPayable])).toEqual([
      ['6005', 100, 359000, 35900],
      ['6063', 200, 711000, 71100],
    ]);
  });

  it('an older PI without a per-line Amount Payable still reads; a total-only PI is left to the AI', () => {
    const old = 'Invoice No 9331003291\nALUMINIUM BILLET ALLOY 6061V1-C 8 INCH 5.000 2377.50 484.00 2861.50 14307.50\nTotal 5.000 14307.50 1430.75';
    const r = parseVedantaPiText(old);
    expect(r.complete).toBe(true);
    expect(r.data.lines[0]).toMatchObject({ amount: 14307.5, amountPayable: null });
    expect(r.data.amountPayable).toBe(1430.75);
    expect(parseVedantaPiText('Invoice No 9331002708\nTotal 25.000 68258.75 6825.88').complete).toBe(false);
  });
});

describe('round BP — each order takes its own PI line (blanks only)', () => {
  const draft = contractDraftFromPi(parseVedantaPiText(PI_4393).data, { suppliers: [], customers: [] });

  it('#30 (6005 100 t) → 359,000.00 / deposit 35,900.00 due 6 Nov; #31 (6063 200 t) → 711,000.00 / 71,100.00', () => {
    expect(draft.depositDueDate).toBe('2026-11-06');
    const a = piFillFor(order(), draft);
    expect(a).toMatchObject({ piNo: '9331004393', piAmount: 359000, depositAmount: 35900 });
    expect((a.depositDueDate as Date).toISOString().slice(0, 10)).toBe('2026-11-06');
    expect(piFillFor(order({ grade: '6063', qtyMt: 200 }), draft)).toMatchObject({ piAmount: 711000, depositAmount: 71100 });
  });

  it('typed values are never overwritten; a line that cannot be told apart leaves the amounts alone', () => {
    expect(piFillFor(order({ piNo: 'X', piAmount: 1, depositAmount: 2, depositDueDate: new Date('2026-11-10'), piDate: new Date('2026-11-01') }), draft)).toEqual({});
    expect(piFillFor(order({ grade: '1070' }), draft)).not.toHaveProperty('piAmount');
    expect(piLineForOrder(draft.lines, { grade: '6063', qtyMt: 200 })?.amountPayable).toBe(71100);
  });

  it('without a printed Amount Payable the deposit is still the order % of the amount', () => {
    const one = contractDraftFromPi({ ...parseVedantaPiText(PI_4393).data, lines: [], amountPayable: null }, { suppliers: [], customers: [] });
    expect(piFillFor(order(), { ...one, piAmount: 100000 })).toMatchObject({ piAmount: 100000, depositAmount: 10000 });
  });
});

describe('round BP — step 1 is due on the PI\'s instrument date', () => {
  it('the printed date wins over PI date + term', () => {
    expect(dueOf('PI_PAYMENT', { piDate: '2026-11-03', depositDueDays: 5, depositDueUnit: 'BUSINESS', depositDueDate: '2026-11-06' }).due).toBe('2026-11-06');
    expect(dueOf('PI_PAYMENT', { piDate: '2026-11-03', depositDueDays: 5, depositDueUnit: 'BUSINESS' }).due).toBe('2026-11-10');
  });
});
