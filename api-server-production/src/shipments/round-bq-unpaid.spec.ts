/** Round BQ — Unpaid fixes: paid = step done, CI − deposit paid, one row per real invoice / bill, filed customer invoices, import tax estimate. */
import { depositPaidOf, distinctInvoices, dueWithNext, invoiceEntries, mergeSharedBill, paidByRemittance, TradeUnpaidService } from './trade-unpaid.service';
import { invoiceFromAi, invoiceFromText, invoicesFromAi, readInvoiceBuffer, InvoiceFacts } from './trade-invoice-read';

const MITSUI = (no: string, total: string, issued: string, ref: string) => `〒 107-0052
アジアディールハブジャパン合同会社 御中
（A3279） FAX: 03-6775-3176
¥${total}-
10%
${issued}
${no}
2026年9月29日
10月 末日迄
${ref}
銀行振込`;
const ADH = (no: string, total: string, due: string) => `番号： ${no}
発行日： 2026/11/9
アジアディールハブ合同会社
合計(税込) ${total}
${due}`;

describe('round BQ — invoice reader', () => {
  it("Mitsui Soko's 請求書: ¥ total, 2FME no., due end of the month, the IM3Z reference", () => {
    expect(invoiceFromText(MITSUI('2FMEJAEF0204', '1,547,123', '2026年10月22日', 'IM3Z690456'))).toMatchObject({ issuer: 'Mitsui Soko (三井倉庫)', invoiceNo: '2FMEJAEF0204', reference: 'IM3Z690456', total: 1547123, currency: 'JPY', issueDate: '2026-10-22', dueDate: '2026-10-31' });
    // Re-issued on 2 Nov, still "10月 末日迄" = 31 Oct (not next year).
    expect(invoiceFromText(MITSUI('2FMEJAEF0547', '769,774', '2026年11月2日', 'IM3Z6A0568'))?.dueDate).toBe('2026-10-31');
  });
  it("ADH's own 請求書: USD total + due; a credit is negative; 次回… = with the next invoice", () => {
    expect(invoiceFromText(ADH('202611_01', '$162,205.08', '2026/11/16 までにお支払いをお願い致します。'))).toMatchObject({ invoiceNo: '202611_01', total: 162205.08, currency: 'USD', dueDate: '2026-11-16', issueDate: '2026-11-09', dueWithNext: false });
    expect(invoiceFromText(ADH('20260910-01', '(US$1,217.87)', '')))?.toMatchObject({ total: -1217.87 });
    expect(invoiceFromText(ADH('202610_004', '$1,107.44', '次回ご請求書お支払い期限 までにお支払いをお願い致します。'))).toMatchObject({ dueDate: null, dueWithNext: true });
  });
  it('Wan Hai debit note and Maersk invoice from the text layer; scans go to the AI (several invoices per file, one retry)', async () => {
    expect(invoiceFromText('WAN HAI LINES LTD.\nCONTAINER Detention (DEBIT NOTE)\nB/L NO : 198GX05383\nSUB TOTAL: YEN 280,000\nGRAND TOTAL: YEN 308,000')).toMatchObject({ docKind: 'debit_note', invoiceNo: 'Detention 198GX05383', total: 308000 });
    expect(invoiceFromText('Invoice Number 7680666870\nMaersk A/S\nInvoice Date Oct 30, 2026\nDue Date Nov 2, 2026\nTotal Payable Amount JPY 77,950')).toMatchObject({ issuer: 'Maersk', total: 77950, dueDate: '2026-11-02' });
    expect(invoicesFromAi({ invoices: [{ docKind: 'invoice', issuer: '三井倉庫株式会社', invoiceNo: 'A', total: 1, currency: '円' }, { docKind: 'remittance', total: 2 }] }).map((f) => [f.issuer, f.docKind, f.currency])).toEqual([
      ['Mitsui Soko (三井倉庫)', 'invoice', 'JPY'],
      [null, 'remittance', null],
    ]);
    expect(invoiceFromAi({ docKind: 'invoice', dueDate: 'end of month' }).dueDate).toBeNull();
    let calls = 0;
    const r = await readInvoiceBuffer(Buffer.from(''), 'application/pdf', {
      pdfText: async () => '',
      ai: async () => {
        if (calls++ === 0) throw new Error('malformed JSON');
        return { invoices: [{ docKind: 'invoice', invoiceNo: 'X', total: 5 }] };
      },
    });
    expect(r.invoices?.[0]).toMatchObject({ invoiceNo: 'X', total: 5, via: 'ai' });
    expect((await readInvoiceBuffer(Buffer.from(''), 'application/pdf', { pdfText: async () => '' })).invoices).toBeNull();
  });
});

const facts = (o: Partial<InvoiceFacts>): InvoiceFacts => ({ docKind: 'invoice', issuer: 'Mitsui Soko (三井倉庫)', invoiceNo: null, issueDate: null, dueDate: null, dueWithNext: false, currency: 'JPY', total: null, via: 'text', layout: 't', ...o });

describe('round BQ — Unpaid rules (pure)', () => {
  it('deposit paid = recorded payment, else step 1 done / paid date; not paid → null', () => {
    expect(depositPaidOf({ depositAmount: 54901.5 }, { status: 'DONE' })).toBe(54901.5);
    expect(depositPaidOf({ depositAmount: null, piAmount: 100000, depositPct: 10 }, { status: 'DONE' })).toBe(10000);
    expect(depositPaidOf({ depositAmount: 35900 }, { status: 'IN_PROGRESS' })).toBeNull();
    expect(depositPaidOf({ depositAmount: 35900 }, { status: 'IN_PROGRESS', payment: { amount: 35000, paidAt: '2026-11-07', account: 'DBS' } })).toBe(35000);
    expect(depositPaidOf({ depositAmount: null, piAmount: null }, { status: 'DONE' })).toBeNull();
  });
  it('a re-issue (same reference) replaces the earlier invoice; the same no. filed twice counts once; receipts drop out', () => {
    const e = (fileId: string, f: Partial<InvoiceFacts> | null, createdAt = '2026-11-01') => ({ fileId, part: 0, createdAt, facts: f ? facts(f) : null });
    const out = distinctInvoices([
      e('a', { invoiceNo: '0497', reference: 'IM1', issueDate: '2026-10-31', total: 923774 }),
      e('b', { invoiceNo: '0547', reference: 'IM1', issueDate: '2026-11-02', total: 769774 }),
      e('c', { invoiceNo: '0204', total: 1 }),
      e('d', { invoiceNo: '0204', total: 1 }, '2026-11-03'),
      e('r', { docKind: 'remittance', total: 308000 }),
      e('u', null),
    ]);
    expect(out.map((x) => x.fileId).sort()).toEqual(['b', 'd', 'u']);
  });
  it('a bill file on several shipments is one row (A3279: trucking + storage); remittance of the same amount settles; with-next due', () => {
    const merged = mergeSharedBill([facts({ invoiceNo: '3YVAJAKD0014', total: 2263800 }), facts({ invoiceNo: '3YVAJAZH0003', total: 88634, dueDate: '2026-11-30' }), facts({ docKind: 'remittance', total: 1 })], 3);
    expect(merged?.[0]).toMatchObject({ invoiceNo: '3YVAJAKD0014 + 3YVAJAZH0003', total: 2352434, dueDate: '2026-11-30' });
    expect(merged).toHaveLength(2);
    expect(mergeSharedBill([facts({ invoiceNo: 'x' }), facts({ invoiceNo: 'y' })], 1)).toHaveLength(2);
    expect(invoiceEntries({ id: 'f', createdAt: new Date('2026-11-01') }, null)).toEqual([expect.objectContaining({ fileId: 'f', part: 0, parts: 1, facts: null })]);
    expect(paidByRemittance(facts({ total: 308000 }), [facts({ docKind: 'remittance', total: 308000 })])).not.toBeNull();
    expect(paidByRemittance(facts({ total: 308000 }), [facts({ docKind: 'remittance', total: 30800 })])).toBeNull();
    expect(dueWithNext('2026-10-08', [{ dueDate: '2026-11-16', issueDate: '2026-11-09', documentNo: 'Invoice 202611_01' }, { dueDate: '2026-10-01', issueDate: '2026-09-01', documentNo: 'old' }])).toEqual({ dueDate: '2026-11-16', with: 'Invoice 202611_01' });
  });
});

describe('round BQ — Unpaid list', () => {
  const ORDER = (n: number, extra: Record<string, unknown> = {}) => ({ id: `o${n}`, orderNo: n, status: 'OPEN', isTest: false, customer: { id: 'kato', name: 'Kato' }, ...extra });
  const setup = () => {
    const prisma: any = {
      tradePaymentAllocation: { findMany: jest.fn(async () => [{ targetType: 'VENDOR_INVOICE', targetId: 'v16', targetLabel: '2FMEJAEF0205', amount: 505276 }]) },
      tradeStep: {
        findMany: jest.fn(async ({ where }: any) => {
          if (where.code?.in?.includes('CI_PAYMENT'))
            return [
              // CI with the deposit paid (step 1 done) vs not paid yet.
              { id: 'ci14', code: 'CI_PAYMENT', status: 'NOT_STARTED', payment: null, order: null, shipment: { id: 's14', seqNo: 1, ciNumber: 'XP1', ciAmount: 551667.12, currency: 'USD', costs: null, order: { id: 'o14', orderNo: 14, depositAmount: 54901.5, steps: [{ status: 'DONE', payment: null }], shipments: [{ id: 's14' }], supplier: { name: 'Vedanta' } }, fileLinks: [], steps: [] } },
              { id: 'ci29', code: 'CI_PAYMENT', status: 'NOT_STARTED', payment: null, order: null, shipment: { id: 's29', seqNo: 1, ciNumber: 'XP2', ciAmount: 351200, currency: 'USD', costs: null, order: { id: 'o29', orderNo: 29, depositAmount: 35120, steps: [{ status: 'IN_PROGRESS', payment: null }], shipments: [{ id: 's29' }], supplier: { name: 'Vedanta' } }, fileLinks: [{ id: 'p' }], steps: [] } },
              // Import tax: the permit's actual; a customer with no import permit (Thailand) has none.
              { id: 'tx18', code: 'TAX_FUNDS', status: 'NOT_STARTED', payment: null, order: null, shipment: { id: 's18', seqNo: 2, costs: { importTaxActual: 1234500 }, order: { id: 'o18', orderNo: 18 }, fileLinks: [], steps: [{ notApplicable: false }] } },
              { id: 'tx14', code: 'TAX_FUNDS', status: 'NOT_STARTED', payment: null, order: null, shipment: { id: 's14', seqNo: 1, costs: {}, order: { id: 'o14', orderNo: 14 }, fileLinks: [], steps: [{ notApplicable: true }] } },
            ];
          // Receipt steps: #27 step 2 open; #25 step 2 DONE (= received).
          return [
            { id: 'r27', orderId: 'o27', code: 'INVOICE_1', status: 'NOT_STARTED', payment: null, skipReason: null, notApplicable: false, requiredDocTypes: ['INVOICE_SINGLE'] },
            { id: 'r25', orderId: 'o25', code: 'INVOICE_1', status: 'DONE', payment: null, skipReason: null, notApplicable: false, requiredDocTypes: ['INVOICE_1'] },
          ];
        }),
      },
      tradeFile: {
        findFirst: jest.fn(async () => ({ id: 'proof' })),
        findMany: jest.fn(async ({ where }: any) => {
          if (where.docType === 'VENDOR_INVOICE') {
            const ship = (id: string, orderNo: number, seq: number, step: string) => ({ shipment: { id, seqNo: seq, status: 'OPEN', order: { id: `o${orderNo}`, orderNo, status: 'OPEN', isTest: false }, steps: [{ id: `l-${id}`, status: step, notApplicable: false }] } });
            return [
              { id: 'v15', fileName: '請求書_IM3Z690456.pdf', createdAt: new Date('2026-10-23'), links: [ship('s15', 15, 1, 'NOT_STARTED')] },
              { id: 'v16', fileName: '請求書_IM3Z6A0049.pdf', createdAt: new Date('2026-10-23'), links: [ship('s16', 16, 1, 'NOT_STARTED')] },
              { id: 'a3279', fileName: 'A3279.pdf', createdAt: new Date('2026-11-05'), links: [ship('s15', 15, 1, 'NOT_STARTED'), ship('s16', 16, 1, 'NOT_STARTED')] },
              { id: 'v13', fileName: '通関運送費.pdf', createdAt: new Date('2026-10-26'), links: [ship('s13', 13, 1, 'DONE')] },
              { id: 'wh', fileName: '198GX05383.pdf', createdAt: new Date('2026-10-22'), links: [ship('s15', 15, 1, 'NOT_STARTED')] },
              { id: 'rem', fileName: 'Remittance.pdf', createdAt: new Date('2026-11-09'), links: [ship('s15', 15, 1, 'NOT_STARTED')] },
            ];
          }
          return [
            { id: 'k01', docType: 'INVOICE_SINGLE', fileName: '202611_01.pdf', createdAt: new Date('2026-11-10'), links: [{ shipmentId: null, order: ORDER(27), shipment: null }] },
            { id: 'k04', docType: 'INVOICE_ADJUSTMENT', fileName: '(正誤差額)_請求書.pdf', createdAt: new Date('2026-10-26'), links: [{ shipmentId: null, order: ORDER(22), shipment: null }] },
            { id: 'k25', docType: 'INVOICE_1', fileName: 'inv1.pdf', createdAt: new Date('2026-11-09'), links: [{ shipmentId: null, order: ORDER(25), shipment: null }] },
          ];
        }),
      },
      tradeExtraction: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
      tradeGeneratedDoc: { findMany: jest.fn(async () => []) },
      tradePayment: { create: jest.fn(async () => ({ id: 'p1' })) },
    };
    const due: any = { openItems: jest.fn(async () => [{ stepId: 'ci14', due: '2026-09-29' }]) };
    const steps: any = { setPayment: jest.fn(async () => ({})) };
    const read = new Map<string, InvoiceFacts[] | null>([
      ['v15', [facts({ invoiceNo: '2FMEJAEF0204', total: 1547123, dueDate: '2026-10-31' })]],
      ['v16', [facts({ invoiceNo: '2FMEJAEF0205', total: 505276, dueDate: '2026-10-31' })]],
      ['a3279', [facts({ invoiceNo: '3YVAJAKD0014', total: 2263800 }), facts({ invoiceNo: '3YVAJAZH0003', total: 88634 })]],
      ['v13', [facts({ invoiceNo: '4FCG', total: 311088 })]],
      ['wh', [facts({ issuer: 'Wan Hai Lines', docKind: 'debit_note', invoiceNo: 'Detention 198GX05383', total: 308000 })]],
      ['rem', [facts({ issuer: 'ADH', docKind: 'remittance', total: 308000 })]],
      ['k01', [facts({ issuer: 'Asia Deal Hub', invoiceNo: '202611_01', currency: 'USD', total: 162205.08, issueDate: '2026-11-09', dueDate: '2026-11-16' })]],
      ['k04', [facts({ issuer: 'Asia Deal Hub', invoiceNo: '202610_004', currency: 'USD', total: 1107.44, issueDate: '2026-10-08', dueWithNext: true })]],
      ['k25', [facts({ issuer: 'Asia Deal Hub', invoiceNo: 'ADH-1', currency: 'USD', total: 858950.4, dueDate: '2026-10-21' })]],
    ]);
    return { svc: new TradeUnpaidService(prisma, due, steps), prisma, steps, read };
  };

  it('to pay: CI − deposit paid; one row per Mitsui invoice + the shared A3279 bill; paid bills / step 12 done / remitted debit notes drop off; permit actual; no-date rows last', async () => {
    const { svc, read } = setup();
    const r = await svc.list('org', '2026-11-10', { invoiceFacts: read });
    const by = (k: string) => r.pay.find((x) => x.key === k);
    expect(by('step:ci14')).toMatchObject({ amount: 496765.62, note: 'CI 551,667.12 − deposit paid 54,901.50', reason: 'step 6 not done', status: 'overdue' });
    expect(by('step:ci29')).toMatchObject({ amount: 351200, note: 'full CI (deposit not paid yet)', reason: 'step 6 not done · a CI payment proof is filed — check step 6' });
    expect(by('step:tx18')).toMatchObject({ amount: 1234500, note: 'import permit (actual)' });
    expect(by('step:tx14')).toBeUndefined();
    expect(by('file:v15')).toMatchObject({ kind: 'LOGISTICS', counterparty: 'Mitsui Soko (三井倉庫)', documentNo: '2FMEJAEF0204', amount: 1547123, dueDate: '2026-10-31', recordOn: 'allocation', stepId: 'l-s15', reason: 'invoice 2FMEJAEF0204 · step 12 not done (#15-1)' });
    expect(by('file:v16')).toBeUndefined(); // marked paid (allocation)
    expect(by('file:v13')).toBeUndefined(); // step 12 done
    expect(by('file:wh')).toBeUndefined(); // remittance of the same amount filed
    expect(by('file:a3279')).toMatchObject({ ref: '#15-1, #16-1', shipmentIds: ['s15', 's16'], documentNo: '3YVAJAKD0014 + 3YVAJAZH0003', amount: 2352434, dueDate: null, stepId: null, note: 'shared bill (2 shipments)' });
    expect(r.pay.at(-1)?.dueDate).toBeNull();
    expect(r.pay.findIndex((x) => !x.dueDate)).toBeGreaterThan(r.pay.findIndex((x) => x.key === 'file:v15'));
  });

  it('to receive: filed customer invoices; the customer payment step done = received; a correction is due with the next invoice', async () => {
    const { svc, read } = setup();
    const r = await svc.list('org', '2026-11-10', { invoiceFacts: read });
    expect(r.receive.map((x) => [x.ref, x.documentNo, x.amount, x.dueDate, x.reason, x.note])).toEqual([
      ['#22', '正誤差額 202610_004', 1107.44, '2026-11-16', 'no receipt recorded', 'paid with Invoice 202611_01'],
      ['#27', 'Invoice 202611_01', 162205.08, '2026-11-16', 'step 2 not done (no receipt recorded)', 'filed PDF'],
    ]);
    expect(r.receiveTotals).toEqual({ USD: 163312.52 });
  });

  it('Mark paid on a vendor bill records an OUT payment allocated to it (labelled with its number); a filed customer invoice on its step', async () => {
    const { svc, prisma, steps, read } = setup();
    // markPaid re-lists with the stored reads: hand them over through the extraction table.
    prisma.tradeExtraction.findMany.mockImplementation(async () => [...read.entries()].map(([fileId, invoices]) => ({ fileId, result: { invoices } })));
    const out = await svc.markPaid('org', { key: 'file:v15', paidAt: '2026-11-10', account: 'SMBC_JPY', proofFileId: 'proof' }, { id: 'u', name: 'Take' } as any);
    expect(out).toMatchObject({ recorded: 'payment', amount: 1547123, currency: 'JPY' });
    expect(prisma.tradePayment.create.mock.calls[0][0].data).toMatchObject({ direction: 'OUT', counterpartyType: 'LOGISTICS', proofFileId: 'proof', allocations: { create: [expect.objectContaining({ targetType: 'VENDOR_INVOICE', targetId: 'v15', targetLabel: '2FMEJAEF0204', shipmentId: 's15' })] } });
    await svc.markPaid('org', { key: 'file:k01', paidAt: '2026-11-14', account: 'CFSB' }, { id: 'u' } as any);
    expect(steps.setPayment).toHaveBeenCalledWith('org', 'r27', { payment: { amount: 162205.08, currency: 'USD', paidAt: '2026-11-14', account: 'CFSB', proofFileId: null } });
  });
});
