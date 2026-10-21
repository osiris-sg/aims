/**
 * Round U — the auto-apply tiers (high: a hard key in an attachment / the own text; medium: a thread / cue
 * decision that agrees with the thread's most recent accepted link) and the per-candidate reasons the picker shows.
 */
import { autoTier, decideMatch, EmailEvidence, findKeyHits, MatchRecord } from './email-match.rules';

const rec = (o: Partial<MatchRecord> & Pick<MatchRecord, 'orderId' | 'orderNo'>): MatchRecord => ({ orderStatus: 'OPEN', shipmentId: null, seqNo: null, shipStatus: null, bl: null, piNo: null, ciNo: null, customerKey: null, customerName: null, grade: null, size: null, qtyMt: null, netMt: null, deliveryMonth: null, port: null, ...o });
const RECORDS: MatchRecord[] = [
  rec({ orderId: 'o15', orderNo: 15, shipmentId: 's15', seqNo: 1, shipStatus: 'OPEN', bl: '198GX05383', customerKey: 'SUS', grade: '6063', size: '203 MM', qtyMt: 300, netMt: 300.4, deliveryMonth: '2026-10' }),
  rec({ orderId: 'o16', orderNo: 16, shipmentId: 's16-1', seqNo: 1, shipStatus: 'OPEN', bl: '198GX05781', customerKey: 'SUS', grade: '6005C', size: '203 MM', qtyMt: 120, netMt: 100, deliveryMonth: '2026-10' }),
  rec({ orderId: 'o16', orderNo: 16, shipmentId: 's16-2', seqNo: 2, shipStatus: 'OPEN', bl: '198GX06003', customerKey: 'SUS', grade: '6005C', size: '203 MM', qtyMt: 120, netMt: 20.4, deliveryMonth: '2026-10' }),
  rec({ orderId: 'o20', orderNo: 20, shipmentId: 's20', seqNo: 1, shipStatus: 'OPEN', bl: '276956322', customerKey: 'KATO', grade: '6005C', size: '203 MM', qtyMt: 40, netMt: 40.3, deliveryMonth: '2026-11' }),
];
const SUS_THREAD = 'Re: ビレット案件（10月納入6005ー120t, 6063ー300t）_アジアディールハブ';
const ev = (subject: string, body = '', attachments: Array<{ name: string; text?: string }> = []): EmailEvidence => ({ subject, body, attachments: attachments.map((a) => ({ name: a.name, text: a.text ?? '' })), date: new Date('2026-10-20') });
const decide = (e: EmailEvidence, thread: Parameters<typeof decideMatch>[0]['thread'] = null) => decideMatch({ ev: e, records: RECORDS, hits: findKeyHits(e, RECORDS), thread });
const ACCEPTED_15 = { accepted: { orderId: 'o15', shipmentId: 's15' }, traced: null, candidates: [{ orderId: 'o15', shipmentId: 's15' }] };

describe('round U — auto-apply tiers', () => {
  it('round W: a hard key in an attachment ALONE is a suggestion; with the own text naming it too (two sources) → high', () => {
    const d = decide(ev(`Re: 【NO取リスト】${SUS_THREAD}`, 'ご確認ください。', [{ name: '22AA198GX06003A.pdf', text: 'B/L 198GX06003 bundle list' }]), ACCEPTED_15);
    expect(d.target).toEqual({ orderId: 'o16', shipmentId: 's16-2' });
    expect(d.sources).toEqual(['attachment']);
    expect(autoTier(d, ACCEPTED_15)).toBeNull();
    const two = decide(ev(`Re: 【NO取リスト】${SUS_THREAD}`, '22AA198GX06003 分のNOリストを送付いたします。', [{ name: '22AA198GX06003A.pdf', text: 'B/L 198GX06003 bundle list' }]), ACCEPTED_15);
    expect(two.sources).toEqual(['attachment', 'own-text']);
    expect(autoTier(two, ACCEPTED_15)).toBe('high');
  });

  it('HIGH: a hard key in the own text + the thread (two sources); not when the subject (single product) contradicts it', () => {
    expect(autoTier(decide(ev(SUS_THREAD, 'B/L 198GX05383 の件です。'), ACCEPTED_15), ACCEPTED_15)).toBe('high');
    expect(autoTier(decide(ev(SUS_THREAD, 'B/L 198GX05383 の件です。'), null), null)).toBeNull(); // the key alone: one source
    const conflict = decide(ev('【10月納入】6005C 120t SUS', 'B/L 198GX05383 の件です。'), ACCEPTED_15);
    expect(conflict.check.length).toBeGreaterThan(0);
    expect(autoTier(conflict, ACCEPTED_15)).toBeNull();
  });

  it("HIGH never when another order's key is in the subject / own text (guard d); an attachment naming its own record is not a conflict (round V)", () => {
    const split = decide(ev('RE: Copy documents //198GX05383', 'see attached', [{ name: 'CI.pdf', text: 'BL 276956322' }]));
    expect(split.target).toEqual({ orderId: 'o15', shipmentId: 's15' });
    expect(split.notes.join(' ')).toMatch(/attachment names #20-1 — it files there/);
    const d = decide(ev('RE: Copy documents //198GX05383', 'about B/L 276956322 too'));
    expect(d.blocked.some((b) => /^d:/.test(b))).toBe(true);
    expect(autoTier(d, null)).toBeNull();
  });

  it('round W: a reply that only follows the thread is ONE source → suggestion; thread + the email text describing it → medium', () => {
    const d = decide(ev(SUS_THREAD, 'ありがとうございます。'), ACCEPTED_15);
    expect(d.source).toBe('thread');
    expect(d.sources).toEqual(['thread']);
    expect(autoTier(d, ACCEPTED_15)).toBeNull();
    const two = decide(ev(SUS_THREAD, '6063 203mm 300t の件、ありがとうございます。'), ACCEPTED_15);
    expect(two.target).toEqual({ orderId: 'o15', shipmentId: 's15' });
    expect(two.sources).toEqual(expect.arrayContaining(['own-text', 'thread']));
    expect(autoTier(two, ACCEPTED_15)).toBe('medium');
    const alone = decide(ev('【11月納入】6005C-8インチ 40T 加藤', 'よろしく'), null);
    expect(alone.source).toBe('order-cues'); // round W: the subject names the order — ONE source → suggestion
    expect(autoTier(alone, null)).toBeNull();
    expect(autoTier(alone, { accepted: { orderId: 'o20', shipmentId: 's20' }, traced: null, candidates: [] })).toBe('medium'); // order-level cues + thread
    const noMonth = decide(ev('6005C-8インチ 40T 加藤', 'よろしく'), null);
    expect(autoTier(noMonth, null)).toBeNull();
  });

  it('a subject key alone is a suggestion; a subject key + the thread agreeing → auto (high: a hard key is among the two)', () => {
    const subjectKey = decide(ev(`${SUS_THREAD} 22AA198GX06003`, 'ご確認お願いします。'), ACCEPTED_15);
    expect(subjectKey.source).toBe('subject');
    expect(autoTier(subjectKey, ACCEPTED_15)).toBeNull(); // #16-2 ≠ the thread's #15-1, and a subject key alone is one source
    const agree = decide(ev(`${SUS_THREAD} 22AA198GX05383`, 'ご確認お願いします。'), ACCEPTED_15);
    expect(agree.sources).toEqual(['subject', 'thread']);
    expect(autoTier(agree, ACCEPTED_15)).toBe('high');
  });

  it('null for the genuine picks: a combined thread with no cue, keys of several orders', () => {
    const combined = { accepted: { orderId: 'o15', shipmentId: 's15' }, traced: null, candidates: [{ orderId: 'o15', shipmentId: 's15' }, { orderId: 'o16', shipmentId: 's16-2' }] };
    const d = decide(ev(SUS_THREAD, '承知しました。'), combined);
    expect(d.target).toBeNull();
    expect(autoTier(d, combined)).toBeNull();
  });
});

describe('round U — the picker says why each candidate fits', () => {
  it('"B/L … in the attachment" / "… only in quoted history" / "subject only" instead of "key in the email" for all', () => {
    const d = decide(ev(`Re: 【NO取リスト】${SUS_THREAD}`, 'ご確認ください。\n\n> 以前: B/L 198GX05383 / 198GX05781', [{ name: '22AA198GX06003A.pdf', text: 'B/L 198GX06003' }]), ACCEPTED_15);
    const by = Object.fromEntries(d.candidates.map((c) => [c.ref, c.reasons.join(', ')]));
    expect(by['#16-2']).toMatch(/^B\/L 198GX06003 in the attachment/);
    expect(by['#15-1']).toMatch(/^B\/L 198GX05383 only in quoted history/);
    expect(by['#16-1']).toMatch(/^B\/L 198GX05781 only in quoted history/);
    const cues = decide(ev('【11月納入】6005C-8インチ 40T 加藤', 'よろしく'));
    expect(cues.candidates[0].ref).toBe('#20-1');
    expect(cues.candidates[0].reasons[0]).toBe('subject only');
    expect(cues.candidates[0].reasons.join(', ')).toMatch(/grade 6005 \(subject\)/);
  });
});
