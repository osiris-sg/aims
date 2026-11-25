import {
  availableQty, directionOf, docTypeLabel, isConfirmedStatus, isoDateOrNull, outstandingQty,
  signedQty, stockValue, supplierOf, NO_SUPPLIER,
} from './inventory-reports';

describe('inventory reports — the rules the ten reports share', () => {
  it('a purchase and an adjustment in ADD stock; a sale, a return and an adjustment out TAKE it', () => {
    expect(directionOf('PO')).toBe(1);
    expect(directionOf('PURCHASE_ORDER')).toBe(1);
    expect(directionOf('SAI')).toBe(1);
    expect(directionOf('INVOICE')).toBe(-1);
    expect(directionOf('DELIVERY_ORDER')).toBe(-1);
    expect(directionOf('PR')).toBe(-1);
    expect(directionOf('SAO')).toBe(-1);
  });

  it('a document that moves no stock (a quotation) is neither in nor out', () => {
    expect(directionOf('QUOTATION')).toBe(0);
    expect(directionOf('')).toBe(0);
  });

  it('the line quantity is signed by its document, never by how it was typed', () => {
    expect(signedQty({ type: 'PO', quantity: 5 })).toBe(5);
    expect(signedQty({ type: 'INVOICE', quantity: 5 })).toBe(-5);
    // A negative typed on an OUT document must not flip it back to an IN.
    expect(signedQty({ type: 'SAO', quantity: -3 })).toBe(-3);
    expect(signedQty({ type: 'SAI', quantity: -3 })).toBe(3);
  });

  it('only a confirmed document has moved stock — draft and unconfirmed have not', () => {
    expect(isConfirmedStatus('confirmed')).toBe(true);
    expect(isConfirmedStatus('delivered_installed')).toBe(true);
    expect(isConfirmedStatus('draft')).toBe(false);
    expect(isConfirmedStatus('unconfirmed')).toBe(false);
    expect(isConfirmedStatus(null)).toBe(false);
  });

  it('outstanding on a purchase line is what has not arrived, and never negative', () => {
    expect(outstandingQty({ quantity: 10, receivedQty: 4 })).toBe(6);
    expect(outstandingQty({ quantity: 10, receivedQty: 0 })).toBe(10);
    // Over-received: the line is complete, not minus two.
    expect(outstandingQty({ quantity: 10, receivedQty: 12 })).toBe(0);
  });

  it('available is on hand less what is already spoken for', () => {
    expect(availableQty({ onHand: 10, reserved: 3 })).toBe(7);
    expect(availableQty({ onHand: 0, reserved: 0 })).toBe(0);
  });

  it('stock value is at cost, rounded to the cent', () => {
    expect(stockValue({ onHand: 3, costPrice: 19.99 })).toBe(59.97);
    expect(stockValue({ onHand: 7, costPrice: 0.335 })).toBe(2.35);
    expect(stockValue({ onHand: 0, costPrice: 100 })).toBe(0);
  });

  it('a blank supplier still totals, under its own heading', () => {
    expect(supplierOf({ supplier: 'Tenda Equipment' })).toBe('Tenda Equipment');
    expect(supplierOf({ supplier: '   ' })).toBe(NO_SUPPLIER);
    expect(supplierOf({ supplier: '' })).toBe(NO_SUPPLIER);
  });

  it('only a real yyyy-mm-dd reaches SQL', () => {
    expect(isoDateOrNull('2026-11-25')).toBe('2026-11-25');
    expect(isoDateOrNull('25/11/2026')).toBeNull();
    expect(isoDateOrNull("2026-11-25'; DROP TABLE")).toBeNull();
    expect(isoDateOrNull(undefined)).toBeNull();
  });

  it('each document prints under the name the legacy menu gives it', () => {
    expect(docTypeLabel('PO')).toBe('Purchase Order');
    expect(docTypeLabel('SAI')).toBe('Stock Adjustment In');
    expect(docTypeLabel('sao')).toBe('Stock Adjustment Out');
    expect(docTypeLabel('WHATEVER')).toBe('WHATEVER');
  });
});
