/** Round BS — SUS COA / PL one per shipment; ADH's own invoices: grouped slots, order matching (40.271 t twin), already filed. */
import { createHash } from 'crypto';
import { formatViews } from './clients';
import { TradeGeneratedService } from './trade-generated.service';
import { matchOutgoingInvoice, readOutgoingInvoice, type InvoiceOrder } from '../ingestion-email/email-outgoing-invoice';
import { EmailTriageService } from '../ingestion-email/email-triage.service';
import { CUSTOMER_INVOICE_TYPES, TRIAGE_DOC_TYPES } from '../ingestion-email/email-triage.rules';

// Excerpts of the text layer of ADH's real 請求書 PDFs (Kato, 2026-11-09 email "請求書送付 12月 アルミビレット").
const INV_0201 = `番号： 202611_01
発行日： 2026/11/9
加藤軽金属工業株式会社 御中
アジアディールハブ合同会社
件名： アルミニウムビレット 6063 8 インチ 〒107-0052
合計(税込) $162,205.08
2026/11/16 までにお支払いをお願い致します。
アルミニウムビレット 6063 8インチ
40.271 3,576.11 144,013.52 563,702 22,700,852`;
const INV_0202 = INV_0201.replace('202611_01', '202611_02').replace(/6063/g, '6005').replace('$162,205.08', '$165,661.77').replace('40.271 3,576.11', '40.855 3,576.11');
const CORR_004 = `番号： 202610_004
発行日： 2026/10/8
加藤軽金属工業株式会社 御中
アジアディールハブ合同会社
件名： アルミニウムビレット 6063 8 インチ 〒107-0052
合計(税込) $1,107.44
40.271 25.00 1,006.77 3,885 156,442 Billet Premium 差額
次回ご請求書お支払い期限 までにお支払いをお願い致します。
条件 ご参考 11月納入分6063 8インチ 40.271MT ご請求
2026/10/2発行 請求書 202610_003 との差額`;

const KATO = ['加藤軽金属工業株式会社', 'Kato Light Metal Industry Co., Ltd.'];
const ORDERS: InvoiceOrder[] = [
  { orderId: 'o21', ref: '#21', customerNames: KATO, grade: '6063 HSB', deliveryMonth: '2026-11', qtyMt: 32, netMts: [28.963] },
  { orderId: 'o22', ref: '#22', customerNames: KATO, grade: '6063', deliveryMonth: '2026-11', qtyMt: 40, netMts: [40.271] },
  { orderId: 'o27', ref: '#27', customerNames: KATO, grade: '6005', deliveryMonth: '2026-12', qtyMt: 40, netMts: [40.855] },
  { orderId: 'o28', ref: '#28', customerNames: KATO, grade: '6063', deliveryMonth: '2026-12', qtyMt: 40, netMts: [40.271] },
  { orderId: 'o25', ref: '#25', customerNames: ['SUS株式会社', 'SUS Co., Ltd.'], grade: '6063', deliveryMonth: '2026-12', qtyMt: 40, netMts: [40.271] },
];

describe('round BS — ADH outgoing invoices: read + match (never on 40.271 t alone)', () => {
  it('reads invoice no., customer, grade, delivery month, qty; a 正誤差額 and the invoice it corrects', () => {
    expect(readOutgoingInvoice(INV_0201, '請求書正式ビレット_加藤軽金属様202612納入_6063 8 インチ 40T.pdf')).toMatchObject({ kind: 'invoice', invoiceNo: '202611_01', addressee: '加藤軽金属工業株式会社', grade: '6063', deliveryMonth: '2026-12', qtyMt: 40.271, total: 162205.08 });
    expect(readOutgoingInvoice(CORR_004, '(正誤差額)_請求書_加藤軽金属様_11月納入6063材40.271Tビレットプレミアム差.pdf')).toMatchObject({ kind: 'correction', invoiceNo: '202610_004', refInvoiceNo: '202610_003', grade: '6063', deliveryMonth: '2026-11' });
    expect(readOutgoingInvoice('COMMERCIAL INVOICE XP2652102958', 'CI.pdf')).toBeNull();
  });
  it('202611_01 → #28, 202611_02 → #27, the correction → #22 — with nothing filed yet (customer + grade + month)', () => {
    const m = (t: string, n: string) => matchOutgoingInvoice(readOutgoingInvoice(t, n)!, ORDERS, [])?.orderId;
    expect(m(INV_0201, '請求書正式ビレット_加藤軽金属様202612納入_6063 8 インチ 40T.pdf')).toBe('o28');
    expect(m(INV_0202, '請求書正式ビレット_加藤軽金属様202612納入_6005 8インチ 40T.pdf')).toBe('o27');
    expect(m(CORR_004, '(正誤差額)_請求書_加藤軽金属様_11月納入6063材40.271Tビレットプレミアム差.pdf')).toBe('o22');
  });
  it('invoice numbers already in AIMS win (the correction follows 202610_003 on #22); 40.271 t alone picks nothing', () => {
    const filed = [{ invoiceNo: '202610_003', orderId: 'o22', ref: '#22' }, { invoiceNo: '202611_01', orderId: 'o28', ref: '#28' }];
    expect(matchOutgoingInvoice(readOutgoingInvoice(CORR_004, '')!, ORDERS, filed)).toEqual({ orderId: 'o22', why: 'corrects invoice 202610_003 (on #22)' });
    expect(matchOutgoingInvoice(readOutgoingInvoice(INV_0201, '')!, ORDERS, filed)).toEqual({ orderId: 'o28', why: 'invoice 202611_01 is already on #28' });
    // No delivery month on the PDF: grade + 40.271 t fit #22 AND #28 — no guess.
    const noMonth = { ...readOutgoingInvoice(INV_0201, '')!, deliveryMonth: null };
    expect(matchOutgoingInvoice(noMonth, ORDERS, [])).toBeNull();
    // Kato's own 6063 Dec only — SUS's 6063 Dec 40.271 t is another customer.
    expect(matchOutgoingInvoice(readOutgoingInvoice(INV_0201, 'x 202612納入')!, ORDERS, [])?.orderId).toBe('o28');
  });
  it('customer invoices are the ORDER’s; "Invoice to client" and "Correction" are slots', () => {
    for (const t of ['INVOICE_1', 'INVOICE_2', 'INVOICE_SINGLE', 'INVOICE_ADJUSTMENT', 'CUSTOMER_INVOICE']) expect(CUSTOMER_INVOICE_TYPES.has(t)).toBe(true);
    expect(TRIAGE_DOC_TYPES.CUSTOMER_INVOICE).toBe('CUSTOMER_INVOICE');
    expect(TRIAGE_DOC_TYPES.INVOICE_ADJUSTMENT).toBe('INVOICE_ADJUSTMENT');
  });
});

describe('round BS — already filed (same bytes) and "Invoice to client" per process', () => {
  const bytes = { a: Buffer.from('202611_01 pdf'), b: Buffer.from('202611_02 pdf'), c: Buffer.from('202610_004 pdf') };
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const setup = (filedShas: string[]) => {
    const log = { id: 'L', inboxState: 'SUGGESTED', actions: {}, rawMeta: { attachments: [{ key: 'bs/k/a', name: 'a.pdf' }, { key: 'bs/k/b', name: 'b.pdf' }, { key: 'bs/k/c', name: 'c.pdf' }] } };
    const prisma: any = {
      emailIngestLog: { findFirst: jest.fn(async () => log), update: jest.fn(async () => ({})) },
      tradeFile: {
        findMany: jest.fn(async ({ where }: any) =>
          (where.sha256.in as string[]).filter((x) => filedShas.includes(x)).map((x, i) => ({ id: `f${i}`, sha256: x, docType: 'INVOICE_SINGLE', links: [{ orderId: 'o28', shipmentId: null, step: { displayNo: '2' }, order: { orderNo: 28 }, shipment: null }] })),
        ),
      },
      tradeOrder: { findFirst: jest.fn(async ({ where }: any) => ({ customerId: where.id === 'oSUS' ? 'sus' : 'kato', steps: [{ status: where.id === 'oSUS2' ? 'DONE' : 'IN_PROGRESS', notApplicable: false }] })) },
    };
    const s3: any = { downloadFile: jest.fn(async (k: string) => (k.endsWith('/a') ? bytes.a : k.endsWith('/b') ? bytes.b : bytes.c)) };
    const config: any = { profileOf: jest.fn(async (_o: string, c: string) => ({ billingMode: c === 'kato' ? 'SINGLE' : 'TWO_STAGE' })) };
    const actionLog: any = { system: jest.fn() };
    return { svc: new EmailTriageService(prisma, s3, {} as any, config, {} as any, actionLog), prisma, actionLog };
  };
  it('every file already in AIMS → the card closes as "Already filed" (logged); one new file → stays open', async () => {
    const all = setup([sha(bytes.a), sha(bytes.b), sha(bytes.c)]);
    const places = await all.svc.closeIfAllFiled('org', 'L', { id: 'u', name: 'Sayaka' } as any);
    expect(places).toEqual([
      { file: 'a.pdf', on: ['#28 · step 2'] },
      { file: 'b.pdf', on: ['#28 · step 2'] },
      { file: 'c.pdf', on: ['#28 · step 2'] },
    ]);
    expect(all.prisma.emailIngestLog.update.mock.calls[0][0].data).toMatchObject({ inboxState: 'PROCESSED', orderId: 'o28', actions: { answered: { kind: 'already_filed', by: 'Sayaka' } } });
    expect(all.actionLog.system).toHaveBeenCalledWith('email-question', 'PROCESS', 'EmailIngestLog', expect.objectContaining({ resourceId: 'L' }));
    const some = setup([sha(bytes.a)]);
    expect(await some.svc.closeIfAllFiled('org', 'L', null)).toBeNull();
    expect(some.prisma.emailIngestLog.update).not.toHaveBeenCalled();
  });
  it('"Invoice to client" → the order’s slot: single (Kato) / #1 until step 2 is done, then #2 (two-stage)', async () => {
    const { svc } = setup([]);
    const t = (id: string | null) => (svc as any).customerInvoiceType('org', id);
    expect(await t('o28')).toBe('INVOICE_SINGLE');
    expect(await t('oSUS')).toBe('INVOICE_1');
    expect(await t(null)).toBe('INVOICE_SINGLE');
  });
});

describe('round BS — SUS customer COA / PL: one per shipment unless "Combine shipments of one delivery"', () => {
  const profile = (combine?: boolean) => ({ customerId: 'sus', billingMode: 'TWO_STAGE', sendImportPermit: true, truckCapacityT: 20, docVariants: { CUSTOMER_COA: 'CUSTOMER_COA_SUS_SUMMARY', CUSTOMER_PL: 'CUSTOMER_PL_SUS_XLS' }, docFormats: combine === undefined ? {} : { CUSTOMER_COA: { combineShipments: combine } } }) as any;
  it('Document formats offer the switch for SUS layouts only (off by default)', () => {
    const v = formatViews(profile(), 'SUS株式会社');
    expect(v.find((x) => x.docType === 'CUSTOMER_COA')?.combineShipments).toBe(false);
    expect(v.find((x) => x.docType === 'CUSTOMER_PL')?.combineShipments).toBe(false);
    expect(v.find((x) => x.docType === 'SGJP_IV_PL')?.combineShipments).toBeNull();
    expect(formatViews(profile(true), 'SUS').find((x) => x.docType === 'CUSTOMER_COA')?.combineShipments).toBe(true);
    const kato = { ...profile(), docVariants: { CUSTOMER_COA: 'CUSTOMER_COA_KATO', CUSTOMER_PL: 'CUSTOMER_PL_KATO' } };
    expect(formatViews(kato, 'Kato').find((x) => x.docType === 'CUSTOMER_COA')?.combineShipments).toBeNull();
  });
  const make = (p: any) => {
    const prisma: any = {
      tradeFile: { findFirst: jest.fn(async () => ({ id: 'src', docType: 'COA_XLS', fileName: 'COA.XLS', s3Key: 'k' })) },
      tradeGeneratedDoc: { create: jest.fn(async ({ data }: any) => ({ id: 'g', ...data })) },
    };
    const config: any = { docRefFor: jest.fn(async () => '26-25-1-CCOA') };
    const svc = new TradeGeneratedService(prisma, {} as any, {} as any, config, {} as any, {} as any, {} as any);
    const built = { built: { columns: [], rows: [{ castNo: 'X' }], notes: [] }, header: { date: '31/10/2026', invoiceNo: 'XP2652102958' } };
    Object.assign(svc as any, {
      loadShipment: jest.fn(async () => ({ id: 's1', status: 'OPEN' })),
      profileForShipment: jest.fn(async () => p),
      susLot: jest.fn(async () => [{ id: 's1' }, { id: 's2' }, { id: 's3' }]),
      buildSusLot: jest.fn(async () => ({ ...built, header: { dateLine: '31/10/2026 · 05/11/2026', invoiceNo: 'XP2652102958 / XP2652102828' } })),
      buildFromSource: jest.fn(async () => built),
    });
    return { svc, prisma };
  };
  it('default: #25-1 gets its own COA (its B/L, CI, date) — no lot, no coversShipmentIds', async () => {
    const { svc, prisma } = make(profile());
    await svc.createFromSource('org', 's1', 'CUSTOMER_COA', 'src', { id: 'u', name: 'Sayaka' } as any);
    expect((svc as any).susLot).not.toHaveBeenCalled();
    const data = prisma.tradeGeneratedDoc.create.mock.calls[0][0].data;
    expect(data.coversShipmentIds).toBeUndefined();
    expect(data.header).toEqual({ date: '31/10/2026', invoiceNo: 'XP2652102958' });
  });
  it('switch on (or the B/Ls picked by hand): one document over the delivery, as round AO', async () => {
    const on = make(profile(true));
    await on.svc.createFromSource('org', 's1', 'CUSTOMER_COA', 'src', {} as any);
    expect(on.prisma.tradeGeneratedDoc.create.mock.calls[0][0].data.coversShipmentIds).toEqual(['s1', 's2', 's3']);
    const byHand = make(profile());
    await byHand.svc.createFromSource('org', 's1', 'CUSTOMER_COA', 'src', {} as any, { coversShipmentIds: ['s2'] });
    expect((byHand.svc as any).susLot).toHaveBeenCalled();
  });
});
