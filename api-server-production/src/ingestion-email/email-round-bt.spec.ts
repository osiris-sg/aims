/** Round BT — the card follows the per-file results: "Already in AIMS" when every file is filed; ADH's invoices → their orders. */
import { questionOf, QuestionInput } from './email-question';

const summaryOf = (o: string, sh: string | null) => (sh ? null : ({ o22: '#22 · Kato 6063 · 40 t', o27: '#27 · Kato 6005 · 40 t', o28: '#28 · Kato 6063 · 40 t' } as Record<string, string>)[o] ?? null);
const refOf = (o: string, sh: string | null) => (sh ? `#${o.slice(1)}-1` : `#${o.slice(1)}`);
const base = (o: Partial<QuestionInput>): QuestionInput => ({ lang: 'en', reasonCode: 'PICK_SHIPMENT', subject: '請求書送付 12月 アルミビレット', company: 'Asia Deal Hub', attachments: ['a.pdf', 'b.pdf', 'c.pdf'], keys: {}, threadSize: 1, suggested: null, candidates: [], check: [], summaryOf, refOf, emails: 1, ...o });
const weightGuess = { guess: { kind: 'record' as const, orderId: 'o27', shipmentId: 's271' }, alternatives: [{ kind: 'record' as const, orderId: 'o20', shipmentId: 's201' }], evidence: [{ t: 'key' as const, key: 'net' as const, value: '40.855', where: 'attachment' as const, file: 'b.pdf', on: { orderId: 'o27', shipmentId: 's271' } }], files: 3 };

describe('round BT — card headline from the per-file results', () => {
  it('every file already in AIMS: no "File 3 documents to #27-1?" — "Already in AIMS", where each file is', () => {
    const allFiled = [
      { file: '(正誤差額)_請求書_加藤軽金属様_11月納入6063材40.271Tビレットプレミアム差.pdf', on: ['#22 · step 11'] },
      { file: '請求書正式ビレット_加藤軽金属様202612納入_6063 8 インチ 40T.pdf', on: ['#28 · step 2'] },
      { file: '請求書正式ビレット_加藤軽金属様202612納入_6005 8インチ 40T.pdf', on: ['#27 · step 2'] },
    ];
    const q = questionOf(base({ card: { ...weightGuess, guess: null, alternatives: [], files: 0, allFiled } }));
    expect(q.headline).toBe('Already in AIMS — every file in this email is filed. Close it?');
    expect(q.guess).toBeNull();
    expect(q.alternatives).toEqual([]);
    expect(q.evidence.map((e) => e.text).join(' | ')).toMatch(/already on #22 · step 11.*already on #28 · step 2.*already on #27 · step 2/);
    // Even an old stored guess is dropped when everything is filed.
    expect(questionOf(base({ card: { ...weightGuess, allFiled } })).headline).not.toMatch(/File \d documents/);
    expect(questionOf(base({ lang: 'ja', card: { ...weightGuess, allFiled } })).headline).toMatch(/^AIMSに登録済み/);
  });
  it('ADH invoices for several orders: "Invoices for #22, #28, #27" — not a shipment by weight', () => {
    const invoices = [
      { file: 'c.pdf', invoiceNo: '202610_004', ref: '#22', why: 'corrects invoice 202610_003 (on #22)' },
      { file: 'a.pdf', invoiceNo: '202611_01', ref: '#28', why: 'invoice 202611_01 · 6063 · Dec delivery → #28' },
      { file: 'b.pdf', invoiceNo: '202611_02', ref: '#27', why: 'invoice 202611_02 · 6005 · Dec delivery → #27' },
    ];
    const q = questionOf(base({ card: { guess: null, alternatives: [], evidence: [], files: 0, invoices, invoiceSplit: ['#22', '#28', '#27'] } }));
    expect(q.headline).toBe('Invoices for #22, #28, #27. Check where each one goes?');
    expect(q.evidence[0].text).toBe('Invoice 202610_004 → #22 (corrects invoice 202610_003 (on #22))');
  });
  it('ADH invoices for one order: the guess is the ORDER ("File 1 document to #28")', () => {
    const q = questionOf(base({ card: { guess: { kind: 'record', orderId: 'o28', shipmentId: null }, alternatives: [], evidence: [], files: 1, invoices: [{ file: 'a.pdf', invoiceNo: '202611_01', ref: '#28', why: 'x' }] } }));
    expect(q.guess).toMatchObject({ orderId: 'o28', shipmentId: null, ref: '#28' });
    expect(q.headline).toMatch(/^File 1 document to #28/);
  });
});
