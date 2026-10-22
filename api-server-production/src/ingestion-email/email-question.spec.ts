/**
 * Round W, Part B — the question card: plain-language titles (EN / JA), "what AIMS found", answer options with a
 * record summary and why, the WhatsApp text with numbered options, and the numbered reply.
 */
import { answerText, parseNumberedReply, plainReason, questionOf, QuestionInput, questionWhatsAppText } from './email-question';

const summaryOf = (orderId: string, shipmentId: string | null) => ({ 'o18:s18-2': '#18-2 · SUS 6005 · 20.4 t · WAN HAI 366 · ETA 29 Oct', 'o19:s19-1': '#19-1 · SUS 6063 · 281.9 t · WAN HAI 366 · ETA 29 Oct', 'o18:': '#18 · SUS 6005 · 220 t' })[`${orderId}:${shipmentId ?? ''}`] ?? null;
const base = (o: Partial<QuestionInput>): QuestionInput => ({ lang: 'en', reasonCode: 'CONFIRM', subject: 'Re: 11月納入 6005C 20.416t', company: 'Mitsui Soko', attachments: ['NO_LIST.pdf'], keys: { blNo: null }, threadSize: 3, threadSubject: 'ビレット案件（11月納入6005Cー220t, 6063ー300t）', suggested: { orderId: 'o18', shipmentId: 's18-2', ref: '#18-2', why: ['net 20.416 in the subject'] }, candidates: [{ orderId: 'o19', shipmentId: 's19-1', ref: '#19-1', why: ['grade 6063 (subject)', 'subject only'] }], check: [], summaryOf, ...o });

describe('round W — question cards', () => {
  it('CONFIRM: one suggestion → "Is this email about #18-2?" with the record summary and why; "what AIMS found" in plain words', () => {
    const q = questionOf(base({ candidates: [] }));
    expect(q.kind).toBe('CONFIRM');
    expect(q.title).toBe('Is this email about #18-2?');
    expect(q.found).toBe('From Mitsui Soko · 1 file · mentions 6005 and 20.416 t · no B/L number · reply in the "ビレット案件（11月納入6005Cー220t, 6063ー3" thread');
    expect(q.options).toHaveLength(1);
    expect(q.options[0]).toMatchObject({ ref: '#18-2', summary: '#18-2 · SUS 6005 · 20.4 t · WAN HAI 366 · ETA 29 Oct', why: 'net 20.416 t in the subject', suggested: true });
    expect(questionOf(base({ candidates: [], suggested: { orderId: 'o18', shipmentId: 's18-2', ref: '#18-2', why: [] } })).options[0].why).toBe(''); // the chip says "AIMS's pick", not the text
    expect(q.extras).toEqual({ createOrder: true, notShipment: true, notDeal: false, askLater: true });
    expect(q.replyHint).toBe('Reply 1 · 0 = ask later · X = not a shipment');
  });

  it('WHICH: several records fit → "Which shipment is this about?", the suggestion first, no record twice, at most 4', () => {
    const q = questionOf(base({ reasonCode: 'PICK_SHIPMENT', candidates: [{ orderId: 'o19', shipmentId: 's19-1', ref: '#19-1', why: ['grade 6063 (subject)'] }, { orderId: 'o18', shipmentId: 's18-2', ref: '#18-2', why: ['dup'] }] }));
    expect(q.kind).toBe('WHICH');
    expect(q.title).toBe('Which shipment is this about?');
    expect(q.options.map((o) => o.ref)).toEqual(['#18-2', '#19-1']);
    expect(q.options[1].why).toBe('6063 (subject)');
    // An order named next to one of its shipments is not a second option.
    const dup = questionOf(base({ reasonCode: 'PICK_SHIPMENT', candidates: [{ orderId: 'o18', shipmentId: null, ref: '#18', why: ['named in the email'] }] }));
    expect(dup.options.map((o) => o.ref)).toEqual(['#18-2']);
    expect(q.replyHint).toBe('Reply 1 or 2 · 0 = ask later · X = not a shipment');
    const orders = questionOf(base({ reasonCode: 'PICK_ORDER', suggested: null, candidates: [{ orderId: 'o18', shipmentId: null, ref: '#18', why: [] }] }));
    expect(orders.title).toBe('Which order is this about?');
  });

  it('CHECK: "The subject says 6063, but AIMS matched #18-2 — which is right?"; NEW_DEAL: one card with the PI details and Create order / Not a deal', () => {
    const c = questionOf(base({ reasonCode: 'CHECK', check: ['grade 6063 ≠ 6005'] }));
    expect(c.kind).toBe('CHECK');
    expect(c.title).toBe('The subject says 6063, but AIMS matched #18-2 — which is right?');
    const d = questionOf(base({ reasonCode: 'NO_ORDER', suggested: null, candidates: [], attachments: ['PI-26100906- Asia deal hub.pdf'], seed: { piNo: 'SIAE_PI_26100906', contractNo: null, grade: '6063', qtyMt: 50, customerKey: null, deliveryMonth: null } }));
    expect(d.kind).toBe('NEW_DEAL');
    expect(d.title).toBe("Is this about the new 6063 · 50 t deal? It isn't in AIMS yet.");
    expect(d.details).toEqual(['PI SIAE_PI_26100906', '6063 · 50 t', 'PI-26100906- Asia deal hub.pdf']);
    expect(d.options).toEqual([]);
    expect(d.extras).toEqual({ createOrder: true, notShipment: false, notDeal: true, askLater: true });
    expect(questionOf(base({ reasonCode: 'NO_ORDER', suggested: null, candidates: [], seed: null })).title).toBe('New deal not in AIMS yet — create the order?');
    expect(questionOf(base({ reasonCode: 'IS_SHIPMENT', suggested: null, candidates: [] })).title).toBe('Is this email about a shipment at all?');
  });

  it('RECHECK: what AIMS filed before vs the second pass, "AIMS re-checked this and isn\'t sure anymore"', () => {
    const q = questionOf(base({ recheck: { current: ['#18-2'], second: [{ orderId: 'o19', shipmentId: 's19-1', ref: '#19-1' }], secondText: 'names #19-1 (verified by a hard key)' } }));
    expect(q.kind).toBe('RECHECK');
    expect(q.title).toMatch(/^AIMS re-checked this and isn't sure anymore/);
    expect(q.options.map((o) => [o.ref, o.why])).toEqual([['#18-2', 'what AIMS filed before'], ['#19-1', 'names #19-1 (verified by a hard key)']]);
  });

  it('Japanese follows the user: titles, "what AIMS found", why, reply hint', () => {
    const q = questionOf(base({ lang: 'ja' }));
    expect(q.title).toBe('どの出荷の件ですか？');
    expect(questionOf(base({ lang: 'ja', candidates: [] })).title).toBe('このメールは #18-2 の件ですか？');
    expect(q.found).toMatch(/^Mitsui Soko から · 添付 1 件 · 6005・20.416 t に言及 · B\/L番号なし · 「/);
    expect(q.options[0].why).toBe('件名に正味 20.416 t');
    expect(q.options[1].why).toBe('材質 6063（件名） · 件名のみ一致');
    expect(q.replyHint).toBe('1 か 2 で返信 · 0 = 後で · X = 出荷ではない');
    expect(questionOf(base({ lang: 'ja', reasonCode: 'NO_ORDER', suggested: null, candidates: [], seed: null })).title).toBe('AIMSにまだない新しい案件です — 注文を作成しますか？');
    expect(plainReason('B/L 198GX06003 in the attachment', 'ja')).toBe('添付にB/L 198GX06003');
    expect(plainReason('B/L 198GX06003 in the attachment', 'en')).toBe('B/L 198GX06003 in the attachment');
    expect(plainReason('an earlier email of this thread was linked to #15-1', 'en')).toBe('an earlier email in this thread went to #15-1');
  });

  it('WhatsApp: the question, the subject, what AIMS found, numbered options, the reply hint; 1 / 2 / 0 / X answer it', () => {
    const q = questionOf(base({ reasonCode: 'PICK_SHIPMENT' }));
    const text = questionWhatsAppText(q, 'Re: 11月納入 6005C 20.416t');
    expect(text.split('\n')).toEqual(['❓ Which shipment is this about?', '"Re: 11月納入 6005C 20.416t"', `— ${q.found}`, '1. #18-2 · SUS 6005 · 20.4 t · WAN HAI 366 · ETA 29 Oct — net 20.416 t in the subject', '2. #19-1 · SUS 6063 · 281.9 t · WAN HAI 366 · ETA 29 Oct — 6063 (subject) · the subject describes it', 'Reply 1 or 2 · 0 = ask later · X = not a shipment']);
    expect(parseNumberedReply('2', q)).toMatchObject({ kind: 'record', option: { ref: '#19-1' } });
    expect(parseNumberedReply(' 0 ', q)).toEqual({ kind: 'later' });
    expect(parseNumberedReply('x', q)).toEqual({ kind: 'not_shipment' });
    expect(parseNumberedReply('7', q)).toBeNull();
    expect(parseNumberedReply('hello', q)).toBeNull();
    const deal = questionOf(base({ reasonCode: 'NO_ORDER', suggested: null, candidates: [], seed: null }));
    expect(questionWhatsAppText(deal, 'Draft - Sales Contract').split('\n').slice(-3)).toEqual(['1. Create the order', '2. Not a deal', 'Reply 1 = create the order · 2 = not a deal · 0 = ask later']);
    expect(parseNumberedReply('1', deal)).toEqual({ kind: 'create_order' });
    expect(parseNumberedReply('2', deal)).toEqual({ kind: 'not_deal' });
    expect(parseNumberedReply('X', deal)).toEqual({ kind: 'not_deal' });
  });

  it('after answering: "Linked to #18-2 · 2 files filed" (and the Japanese), hidden, asked again tomorrow', () => {
    expect(answerText('record', 'en', { refs: ['#18-2'], files: 2 })).toBe('Linked to #18-2 · 2 files filed');
    expect(answerText('record', 'en', { refs: ['#15-1'], files: 0, emails: 3 })).toBe('Linked to #15-1 (3 emails)');
    expect(answerText('record', 'ja', { refs: ['#18-2'], files: 1 })).toBe('#18-2 に紐付けました · 書類 1 件を登録');
    expect(answerText('not_shipment', 'en')).toBe('Hidden — not about a shipment');
    expect(answerText('not_deal', 'ja')).toBe('非表示にしました — 案件ではない');
    expect(answerText('later', 'en')).toBe('Asked again tomorrow');
  });
});
