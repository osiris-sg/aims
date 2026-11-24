import { renderDocumentHtml } from '../common/services/document-html';
import { doNumbersFromConfig, doNumbersFromOrderLinks, invoiceDoNumbers } from './invoice-do-nos';

/** WCT invoice print: "DO No" (the DOs the invoice covers) instead of "Order No" (2026-11-24). */
const org = { name: 'WCT (S) SYSTEMS PTE LTD', address: '1 Test Road', registrationNumber: '200000000A' };
const data = (extra: any = {}) => ({
  documentType: 'INVOICE', name: 'INV202611-0001', organization: org, customer: { name: 'TEST Client', address: '1 Raffles Place' },
  items: [{ description: 'Work', quantity: 1, unitPrice: 600, amount: 600 }], documentInfo: { documentNumber: 'INV202611-0001', date: '2026-11-24' },
  design: { layout: 'wct' }, orderNo: 'ORDW202611-001', ...extra,
});

describe('invoice DO numbers', () => {
  it('from the config: the order invoice list, the source DO, direct DO links; no repeats', () => {
    expect(
      doNumbersFromConfig({
        deliveryOrderNos: ['DO1', 'DO2'],
        sourceDocumentType: 'DELIVERY_ORDER',
        sourceDocumentNumber: 'DO2',
        linkedDocs: [{ id: 'x', type: 'DELIVERY_ORDER', name: 'DO3' }, { id: 'y', type: 'QUOTATION', name: 'QO1' }],
      }),
    ).toEqual(['DO1', 'DO2', 'DO3']);
    expect(doNumbersFromConfig({ sourceDocumentType: 'QUOTATION', sourceDocumentNumber: 'QO1' })).toEqual([]);
    expect(doNumbersFromConfig(null)).toEqual([]);
  });
  it("from the order: linked DOs billed by this invoice only", () => {
    const ld = { do: [{ id: 'a', name: 'DOA', orderInvoiceId: 'inv1' }, { id: 'b', name: 'DOB', orderInvoiceId: 'inv2' }, { id: 'c', name: 'DOC' }] };
    expect(doNumbersFromOrderLinks(ld, 'inv1')).toEqual(['DOA']);
    expect(doNumbersFromOrderLinks(ld, 'inv9', ['c'])).toEqual(['DOC']);
  });
  it('reads the order (same org only) and adds its billed DOs', async () => {
    const prisma: any = { order: { findFirst: jest.fn(async (q: any) => (q.where.organizationId === 'o1' ? { linkedDocuments: { do: [{ id: 'a', name: 'DOA', orderInvoiceId: 'inv1' }] } } : null)) } };
    expect(await invoiceDoNumbers(prisma, 'o1', 'inv1', { orderId: 'ord', deliveryOrderNos: ['DO1'] })).toEqual(['DO1', 'DOA']);
    expect(await invoiceDoNumbers(prisma, 'o2', 'inv1', { orderId: 'ord' })).toEqual([]);
  });
});

describe('WCT invoice print', () => {
  it('"DO No" with the DOs, comma separated; no "Order No"', () => {
    const h = renderDocumentHtml('INVOICE', data({ invoiceDoNos: ['DO202611001', 'DO202611002'] }), org)!;
    expect(h).toContain('<span class="k">DO No</span><span>DO202611001, DO202611002</span>');
    expect(h).not.toContain('Order No');
  });
  it('no DO: the line is left out', () => {
    const h = renderDocumentHtml('INVOICE', data({ invoiceDoNos: [] }), org)!;
    expect(h).not.toContain('DO No');
    expect(h).not.toContain('Order No');
  });
  it('without server data, the invoice\'s own deliveryOrderNos', () => {
    const h = renderDocumentHtml('INVOICE', data({ deliveryOrderNos: ['DO9'] }), org)!;
    expect(h).toContain('<span class="k">DO No</span><span>DO9</span>');
  });
  it('a quotation never gets a DO line', () => {
    const h = renderDocumentHtml('QUOTATION', { ...data({ invoiceDoNos: ['DO9'] }), documentType: 'QUOTATION' }, org)!;
    expect(h).not.toContain('DO No');
  });
});
