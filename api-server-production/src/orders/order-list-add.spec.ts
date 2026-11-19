import { NO_LIST_ADD, PENDING_ORDER_LINK_KEY, importedDoNumbers, importedListAdd, nativeListAdd, pendingOrderLinkOf } from './order-list-add';

// Round 38 (WCT group): the Orders list's "+" in empty Quotation / DO(s) / Invoice cells, the order page's rules.
describe('orders list "+" (order-list-add)', () => {
  const base = { cancelled: false, hasQuotation: true, doCount: 0, invoiceCount: 0, toInvoiceJobs: 0, toInvoiceDos: 0 };
  const manual = { manualFlow: true, invoicing: true };
  const racking = { manualFlow: false, invoicing: true };

  it('manual flow (WCT (S), BC Air): an order with no DO and no invoice offers "+" DO and "+" Invoice', () => {
    expect(nativeListAdd(base, manual)).toEqual({ quotation: false, do: true, invoice: true });
  });

  it('a filled cell never shows "+"', () => {
    expect(nativeListAdd({ ...base, doCount: 1, invoiceCount: 1 }, manual)).toEqual({ quotation: false, do: false, invoice: false });
  });

  it('no quotation: "+" Quotation', () => {
    expect(nativeListAdd({ ...base, hasQuotation: false }, manual).quotation).toBe(true);
  });

  it('a cancelled order shows no "+" at all', () => {
    expect(nativeListAdd({ ...base, cancelled: true, hasQuotation: false }, manual)).toEqual(NO_LIST_ADD);
  });

  it('without the manual flow (Racking): no "+" DO; "+" Invoice only with a verified job or a completed DO to bill', () => {
    expect(nativeListAdd(base, racking)).toEqual({ quotation: false, do: false, invoice: false });
    expect(nativeListAdd({ ...base, toInvoiceJobs: 1 }, racking).invoice).toBe(true);
    expect(nativeListAdd({ ...base, toInvoiceDos: 1 }, racking).invoice).toBe(true);
  });

  it('no invoicing per order: no "+" Invoice', () => {
    expect(nativeListAdd({ ...base, toInvoiceJobs: 2 }, { manualFlow: true, invoicing: false }).invoice).toBe(false);
  });

  it('imported orders: never "+" Quotation; "+" DO in the manual flow; "+" Invoice with the quotation and no invoice', () => {
    expect(importedListAdd({ hasQuotation: true, doCount: 0, invoiceCount: 0 }, { manualFlow: true })).toEqual({ quotation: false, do: true, invoice: true });
    expect(importedListAdd({ hasQuotation: true, doCount: 2, invoiceCount: 1 }, { manualFlow: true })).toEqual({ quotation: false, do: false, invoice: false });
    expect(importedListAdd({ hasQuotation: false, doCount: 0, invoiceCount: 0 }, { manualFlow: false })).toEqual({ quotation: false, do: false, invoice: false });
  });

  it("an imported order's DO(s) cell lists its ERP DO numbers, its linked DOs and its AIMS DOs once each", () => {
    expect(importedDoNumbers(['DO010975'], [{ id: 'a', name: 'DO010975', imported: true }, { id: 'b', name: 'DO011002' }, null, { id: 'c' }], ['DO202611-0007', null, ''])).toEqual([
      'DO010975',
      'DO011002',
      'DO202611-0007',
    ]);
    expect(importedDoNumbers(undefined, undefined, [])).toEqual([]);
  });

  it('the pending order link: only a well-formed order id', () => {
    const id = '0f6c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
    expect(pendingOrderLinkOf({ [PENDING_ORDER_LINK_KEY]: { orderId: id } })).toBe(id);
    expect(pendingOrderLinkOf({ [PENDING_ORDER_LINK_KEY]: { orderId: 'x' } })).toBeNull();
    expect(pendingOrderLinkOf({ [PENDING_ORDER_LINK_KEY]: id })).toBeNull();
    // Every other document (all other orgs and types): no key, nothing happens on save.
    expect(pendingOrderLinkOf({ customerId: 'c' })).toBeNull();
    expect(pendingOrderLinkOf(null)).toBeNull();
  });
});
