/**
 * Round T — the cue priority (attachment key > own-text key > subject key > own-text cues > thread link >
 * subject cues > quoted history), the "subject disagrees" rule (only a single-product subject can) and
 * the cue normalisation (6005C ≈ 6005, 8インチ ≈ 203 MM, 40T ≈ 40.271 t), on the REAL combined-thread
 * subjects Mitsui / Kato reuse for weeks — as dummy fixtures (B/L numbers real, content invented).
 */
import { decideMatch, EmailEvidence, findKeyHits, MATCH_PRIORITY, MatchRecord, ownTextCues, subjectCues } from './email-match.rules';

const rec = (o: Partial<MatchRecord> & Pick<MatchRecord, 'orderId' | 'orderNo'>): MatchRecord => ({ orderStatus: 'OPEN', shipmentId: null, seqNo: null, shipStatus: null, bl: null, piNo: null, ciNo: null, customerKey: null, customerName: null, grade: null, size: null, qtyMt: null, netMt: null, deliveryMonth: null, port: null, ...o });
// The Kato November trio of the combined thread, the SUS October pair, and a December order without a shipment.
const RECORDS: MatchRecord[] = [
  rec({ orderId: 'o20', orderNo: 20, shipmentId: 's20', seqNo: 1, shipStatus: 'OPEN', bl: '276956322', customerKey: 'KATO', grade: '6005C', size: '203 MM X 5800 MM', qtyMt: 40, netMt: 40.271, deliveryMonth: '2026-11', port: 'NAGOYA' }),
  rec({ orderId: 'o21', orderNo: 21, shipmentId: 's21', seqNo: 1, shipStatus: 'OPEN', bl: '198GX06445', customerKey: 'KATO', grade: '6063 HSB', size: '152 MM', qtyMt: 32, netMt: 29.2, deliveryMonth: '2026-11', port: 'NAGOYA' }),
  rec({ orderId: 'o22', orderNo: 22, shipmentId: 's22', seqNo: 1, shipStatus: 'OPEN', bl: '198GX06520', customerKey: 'KATO', grade: '6063', size: '203 MM', qtyMt: 40, netMt: 40.2, deliveryMonth: '2026-11', port: 'NAGOYA' }),
  rec({ orderId: 'o15', orderNo: 15, shipmentId: 's15', seqNo: 1, shipStatus: 'OPEN', bl: '198GX05383', customerKey: 'SUS', grade: '6063', size: '203 MM', qtyMt: 300, netMt: 300.4, deliveryMonth: '2026-10', port: 'YOKOHAMA' }),
  rec({ orderId: 'o16', orderNo: 16, shipmentId: 's16-2', seqNo: 2, shipStatus: 'OPEN', bl: '198GX06003', customerKey: 'SUS', grade: '6005C', size: '203 MM', qtyMt: 120, netMt: 20.4, deliveryMonth: '2026-10', port: 'YOKOHAMA' }),
  rec({ orderId: 'o25', orderNo: 25, customerKey: 'KATO', grade: '6005', size: '203 MM', qtyMt: 40, deliveryMonth: '2026-12' }),
];
const KATO_THREAD = 'Re: 【11月納入】アルミニウムビレット6005C-8インチ 40T 6063ハイスピードビレット-6インチ 32T 6063-8インチ 40T 通関・国内輸送（名古屋港→海部郡 加藤軽金属）';
const SUS_THREAD = 'Re: ビレット案件（10月納入6005ー120t, 6063ー300t）_アジアディールハブ';
const ev = (subject: string, body = '', attachments: Array<{ name: string; text?: string }> = []): EmailEvidence => ({ subject, body, attachments: attachments.map((a) => ({ name: a.name, text: a.text ?? '' })), date: new Date('2026-10-20') });
const decide = (e: EmailEvidence, thread: Parameters<typeof decideMatch>[0]['thread'] = null) => decideMatch({ ev: e, records: RECORDS, hits: findKeyHits(e, RECORDS), thread });
const COMBINED = { accepted: { orderId: 'o21', shipmentId: 's21' }, traced: null, candidates: [{ orderId: 'o20', shipmentId: 's20' }, { orderId: 'o21', shipmentId: 's21' }, { orderId: 'o22', shipmentId: 's22' }] };

describe('round T — the priority order is explicit', () => {
  it('is documented in code in this order', () => {
    expect([...MATCH_PRIORITY]).toEqual(['attachment hard key', 'own-text hard key', 'subject hard key', 'own-text product cues', 'thread link', 'subject cues (tie-break)', 'quoted history (never decides)']);
  });

  it('1. an attachment key beats the (stale) subject key: Vedanta "Copy documents … 198GX06516" with a CI naming 198GX06520', () => {
    // Round V: the email links where its own words / subject point (#21-1); the CI files to the record IT names (#22-1).
    const d = decide(ev('RE: Copy documents - Asia Deal(Kato) //454003598 //198GX06445', 'Please find attached.', [{ name: 'CI.pdf', text: 'Commercial invoice — BL No. 198GX06520, WAN HAI 366' }]));
    expect(d.target).toEqual({ orderId: 'o21', shipmentId: 's21' });
    expect(d.source).toBe('subject');
    expect(d.blocked.some((b) => /^d:/.test(b))).toBe(false);
    expect(d.notes.join(' ')).toMatch(/attachment names #22-1 — it files there/);
    expect(d.multiOrderIds).toEqual([]); // each part is resolved: nothing to pick
    const attOnly = decide(ev('RE: Copy documents', 'Please find attached.', [{ name: 'CI.pdf', text: 'BL No. 198GX06520' }]));
    expect(attOnly.target).toEqual({ orderId: 'o22', shipmentId: 's22' });
    expect(attOnly.source).toBe('attachment');
  });

  it('2. an own-text key beats the combined subject: "6005C… 40T 6063… 32T 6063… 40T" with 198GX06520 in the reply → #22-1, no "subject disagrees", auto', () => {
    const d = decide(ev(KATO_THREAD, 'B/L 198GX06520 の通関手続きが完了しました。\n\n> 以前のメール…'));
    expect(d.target).toEqual({ orderId: 'o22', shipmentId: 's22' });
    expect(d.source).toBe('own');
    expect(d.check).toEqual([]);
    expect(d.auto).toBe(true);
    expect(d.notes.join(' ')).toMatch(/several products/);
  });

  it('3. a subject key alone still decides (the reply names nothing else)', () => {
    const d = decide(ev(`${SUS_THREAD} 22AA198GX06003`, 'ご確認お願いします。'));
    expect(d.target).toEqual({ orderId: 'o16', shipmentId: 's16-2' });
    expect(d.source).toBe('subject');
    expect(d.check).toEqual([]);
  });

  it('4. own-text product cues decide when the own text describes one record: "6005C 8インチ 40t分の納品" on the combined thread → #20-1', () => {
    const d = decide(ev(KATO_THREAD, '6005C 8インチ 40t 分の納品日程を確認します。', []), COMBINED);
    expect(d.target).toEqual({ orderId: 'o20', shipmentId: 's20' });
    expect(['own-cues', 'thread', 'order-cues']).toContain(d.source);
    expect(d.check).toEqual([]);
    expect(d.reason).toMatch(/#20/);
  });

  it('5. the thread link: a reply with no cue of its own on an accepted thread follows the accepted message; a combined thread with nothing to go on is a genuine pick', () => {
    const a = decide(ev(SUS_THREAD, 'ありがとうございます。'), { accepted: { orderId: 'o15', shipmentId: 's15' }, traced: null, candidates: [{ orderId: 'o15', shipmentId: 's15' }] });
    expect(a.target).toEqual({ orderId: 'o15', shipmentId: 's15' });
    expect(a.source).toBe('thread');
    expect(a.check).toEqual([]); // round T: a multi-product subject is NOT "subject disagrees"
    expect(a.auto).toBe(true);
    // Round V: the combined subject names three Kato orders → a link-only reply links to all of them (no "pick").
    const p = decide(ev(KATO_THREAD, '承知しました。'), COMBINED);
    expect(p.target).toBeNull();
    expect(p.links?.map((l) => l.orderId).sort()).toEqual(['o20', 'o21', 'o22']); // the records the thread covers
    expect(p.reason).toMatch(/thread covers/);
    expect(p.check).toEqual([]);
  });

  it('6. subject cues only break ties: a single-product subject describing one open record is a suggestion, never auto', () => {
    const d = decide(ev('【12月納入】6005-8インチ 40T 加藤軽金属様', 'よろしくお願いします。'));
    expect(d.target).toEqual({ orderId: 'o25', shipmentId: null });
    expect(d.source).toBe('order-cues'); // round V: customer + month + grade + qty name the ORDER
    expect(d.auto).toBe(false);
    const vague = decide(ev('6005 8インチ 40T について', 'よろしくお願いします。'));
    expect(vague.source === 'subject-cues' || vague.target === null).toBe(true);
  });

  it('7. quoted history never decides over anything the email itself says, and is only a weak last-resort suggestion', () => {
    const quotedOnly = decide(ev('Re: 通関・国内輸送', 'ありがとうございます。\n\n> B/L 198GX06445 の件'));
    expect(quotedOnly.target).toEqual({ orderId: 'o21', shipmentId: 's21' });
    expect(quotedOnly.auto).toBe(false);
    expect(quotedOnly.blocked.join(' ')).toMatch(/only in the quoted/);
    const withOwn = decide(ev('Re: 通関・国内輸送', '198GX06520 の件です。\n\n> B/L 198GX06445 の件'));
    expect(withOwn.target).toEqual({ orderId: 'o22', shipmentId: 's22' });
    expect(withOwn.notes.join(' ')).toMatch(/quoted text also names #21/);
    expect(withOwn.blocked.some((b) => /^d:/.test(b))).toBe(false); // quoted is a note, not guard d
  });
});

describe('round T — "subject disagrees" only when the subject names ONE product and contradicts', () => {
  it('a single-product subject contradicting an own-text key is a real CHECK (grade)', () => {
    const d = decide(ev('【11月納入】6063-8インチ 40T 加藤', 'B/L 276956322 の件'));
    expect(d.target).toEqual({ orderId: 'o20', shipmentId: 's20' });
    expect(d.check.join(' ')).toMatch(/grade 6063 ≠ 6005/);
    expect(d.auto).toBe(false);
  });

  it('a stale month alone never contradicts a hard key (a note instead); it still counts against a thread / cue decision', () => {
    const d = decide(ev('【10月納入】6005C-8インチ 40T 加藤', 'B/L 276956322 の件'));
    expect(d.check).toEqual([]);
    expect(d.notes.join(' ')).toMatch(/stale thread subject/);
    const t = decide(ev('【10月納入】6005C-8インチ 40T 加藤', 'よろしくお願いします。'), { accepted: { orderId: 'o20', shipmentId: 's20' }, traced: null, candidates: [{ orderId: 'o20', shipmentId: 's20' }] });
    expect(t.check.join(' ')).toMatch(/delivery 2026-10 ≠ 2026-11/);
  });

  it('a multi-product subject is never a conflict, whatever decided', () => {
    for (const body of ['B/L 198GX06445 の件', '6063 HSB 6インチ 32t の件']) {
      const d = decide(ev(KATO_THREAD, body), COMBINED);
      expect(d.target).toEqual({ orderId: 'o21', shipmentId: 's21' });
      expect(d.check).toEqual([]);
    }
  });
});

describe('round T — cue normalisation', () => {
  it('6005C ≈ 6005, 8インチ ≈ 203 MM, 40T ≈ 40.271 t, 11月納入 ≈ 2026-11', () => {
    const c = subjectCues('【11月納入】6005C-8インチ 40T', new Date('2026-10-20'));
    expect(c.grades).toEqual(['6005']);
    expect(c.inches).toEqual([8]);
    expect(c.qtys).toEqual([40]);
    expect(c.months).toEqual(['2026-11']);
    const d = decide(ev('【11月納入】6005C-8インチ 40T 加藤', 'B/L 276956322'));
    expect(d.check).toEqual([]); // 6005C vs record "6005C"/"6005", 203 MM vs 8 inch, 40.271 t vs 40 T all agree
    expect(decide(ev('【11月納入】6005-203MM 40.3t 加藤', 'B/L 276956322')).check).toEqual([]);
  });

  it('own-text cues only count grades that some record has (a phone number is not a grade)', () => {
    const c = ownTextCues('TEL 1659-6988-6775 6005C 8インチ 40t', RECORDS, new Date('2026-10-20'));
    expect(c.grades).toEqual(['6005']);
    expect(c.multi).toBe(false);
  });
});
