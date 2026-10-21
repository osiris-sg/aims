/**
 * Round P: threads — grouping by Message-ID headers with the subject as the
 * fallback, the raw-.eml header parser, the reason chips, the thread's link,
 * and the match decision's thread rules (inherit, trace back, combined threads).
 */
import { groupThreads, normMessageId, threadHeadersFromEml, threadLink, unprocessedReason } from './email-threads';
import { decideMatch, EmailEvidence, findKeyHits, MatchRecord } from './email-match.rules';

const row = (o: Partial<Parameters<typeof groupThreads>[0][number]> & { id: string }) => ({ messageId: `<${o.id}@x>`, inReplyTo: null, references: [], threadKey: null, date: null, inboxState: 'SUGGESTED', orderId: null, shipmentId: null, confidence: null, outcome: null, ...o });

describe('thread grouping', () => {
  it('Message-ID chain: a reply joins the message it replies to (In-Reply-To or References), even with a changed subject', () => {
    const t = groupThreads([
      row({ id: 'a', threadKey: 'copy documents', date: '2026-10-14T01:00:00Z' }),
      row({ id: 'b', inReplyTo: '<a@x>', threadKey: 'something else', date: '2026-10-15T01:00:00Z' }),
      row({ id: 'c', references: ['<zzz@x>', '<a@x>'], threadKey: 'third subject', date: '2026-10-16T01:00:00Z' }),
      row({ id: 'd', threadKey: 'unrelated', date: '2026-10-17T01:00:00Z' }),
    ]);
    expect(t).toHaveLength(2);
    const abc = t.find((x) => x.messages.length === 3)!;
    expect(abc.id).toBe('a'); // the oldest message's id — stable
    expect(abc.by).toBe('headers');
    expect(abc.messages.map((m) => m.id)).toEqual(['c', 'b', 'a']); // newest first
    expect(t[0].id).toBe('d'); // newest thread first
  });
  it('subject fallback: no headers (a worker that posts none / a rebuilt .eml) → the same normalised subject is one thread', () => {
    const t = groupThreads([
      row({ id: 'a', threadKey: '10/16 朝 ビレット 納品明細', date: '2026-10-15T01:30:00Z' }),
      row({ id: 'b', threadKey: '10/16 朝 ビレット 納品明細', date: '2026-10-15T14:22:00Z' }),
      row({ id: 'c', threadKey: '10/16 朝 ビレット 納品明細', date: '2026-10-17T17:04:00Z' }),
      row({ id: 'd', threadKey: '10/19 朝 ビレット 納品明細', date: '2026-10-17T17:07:00Z' }),
    ]);
    expect(t.map((x) => x.messages.length)).toEqual([1, 3]);
    expect(t[1].by).toBe('subject');
  });
  it('headers and subject both tie messages: one thread, "both"; a message without a subject key and without headers stays alone', () => {
    const t = groupThreads([row({ id: 'a', threadKey: 'k', date: '2026-10-15T01:00:00Z' }), row({ id: 'b', inReplyTo: '<a@x>', threadKey: 'k' }), row({ id: 'e', threadKey: null })]);
    expect(t.find((x) => x.messages.length === 2)!.by).toBe('both');
    expect(t.find((x) => x.messages.length === 1)!.id).toBe('e');
  });
  it('raw .eml head: Message-ID / In-Reply-To / References, folded lines joined, body ignored', () => {
    const raw = ['From: a@x', 'Message-ID: <m1@mail.example>', 'In-Reply-To: <m0@mail.example>', 'References: <r1@mail.example>', '\t<m0@mail.example>', 'Subject: Re: x', '', 'Message-ID: <in-the-body@x>'].join('\r\n');
    expect(threadHeadersFromEml(raw)).toEqual({ messageId: 'm1@mail.example', inReplyTo: 'm0@mail.example', references: ['r1@mail.example', 'm0@mail.example'], autoSubmitted: false });
    expect(threadHeadersFromEml('From: a@x\r\n\r\nbody')).toEqual({ messageId: null, inReplyTo: null, references: [], autoSubmitted: false });
    // An Exchange out-of-office: Auto-Submitted / X-Autoreply, no thread headers.
    expect(threadHeadersFromEml('Message-ID: <a@x>\r\nAuto-Submitted: auto-replied\r\nX-Autoreply: yes\r\n\r\nbody').autoSubmitted).toBe(true);
    expect(threadHeadersFromEml('Message-ID: <a@x>\r\nAuto-Submitted: auto-replied\r\n\r\nbody').autoSubmitted).toBe(true);
    // A mailbox forwarding rule stamps "auto-generated" on every forwarded email — that is NOT an auto-reply.
    expect(threadHeadersFromEml('Message-ID: <a@x>\r\nAuto-Submitted: auto-generated\r\n\r\nbody').autoSubmitted).toBe(false);
    expect(normMessageId(' <abc@x> ')).toBe('abc@x');
    expect(normMessageId('')).toBeNull();
  });
});

describe('reason chips and the thread link', () => {
  it('why a message needs a person', () => {
    expect(unprocessedReason({ inboxState: 'SUGGESTED', orderId: 'o', shipmentId: 's' })).toEqual({ code: 'CONFIRM', label: 'Confirm match' });
    expect(unprocessedReason({ inboxState: 'UNMATCHED' })).toEqual({ code: 'PICK_ORDER', label: 'Pick order' });
    expect(unprocessedReason({ inboxState: 'UNMATCHED', orderId: 'o', needsShipment: true })).toEqual({ code: 'PICK_SHIPMENT', label: 'Pick shipment' });
    expect(unprocessedReason({ inboxState: 'UNMATCHED', multiOrderRefs: ['#20', '#21', '#22'] })).toEqual({ code: 'PICK_SHIPMENT', label: 'Pick shipment (thread covers #20/#21/#22)' });
    expect(unprocessedReason({ inboxState: 'SUGGESTED', orderId: 'o', check: ['grade 6005 ≠ 6063'] })).toEqual({ code: 'CHECK', label: 'Check — subject disagrees' });
    expect(unprocessedReason({ inboxState: 'UNSURE' })).toEqual({ code: 'IS_SHIPMENT', label: 'Is it a shipment?' });
    expect(unprocessedReason({ inboxState: 'PROCESSED', orderId: 'o' })).toBeNull();
  });
  it("the thread's link: accepted messages first, else the best suggestion; several distinct links = combined", () => {
    const ms = [row({ id: 'a', inboxState: 'SUGGESTED', orderId: 'o1', shipmentId: 's1', confidence: 'cues' }), row({ id: 'b', inboxState: 'PROCESSED', orderId: 'o2', shipmentId: 's2', confidence: 'manual', outcome: 'ACCEPTED' })];
    expect(threadLink(ms)).toMatchObject({ orderId: 'o2', shipmentId: 's2', from: 'processed', combined: [] });
    expect(threadLink([ms[0]])).toMatchObject({ orderId: 'o1', from: 'suggested' });
    expect(threadLink([row({ id: 'x', inboxState: 'PROCESSED', orderId: 'o9', outcome: 'IGNORED' })])).toMatchObject({ from: 'suggested' });
    expect(threadLink([row({ id: 'x' })])).toBeNull();
    const combined = threadLink([row({ id: 'a', inboxState: 'PROCESSED', orderId: 'o20', shipmentId: 's20', outcome: 'ACCEPTED' }), row({ id: 'b', inboxState: 'PROCESSED', orderId: 'o21', shipmentId: 's21', outcome: 'ACCEPTED' })]);
    expect(combined!.combined).toHaveLength(2);
  });
});

// ── the decision with a thread ─────────────────────────────────────────────
const rec = (o: Partial<MatchRecord> & Pick<MatchRecord, 'orderId' | 'orderNo'>): MatchRecord => ({ orderStatus: 'OPEN', shipmentId: null, seqNo: null, shipStatus: null, bl: null, piNo: null, ciNo: null, customerKey: null, customerName: null, grade: null, size: null, qtyMt: null, netMt: null, deliveryMonth: null, port: null, ...o });
const RECORDS: MatchRecord[] = [
  rec({ orderId: 'o20', orderNo: 20, shipmentId: 's20', seqNo: 1, shipStatus: 'OPEN', bl: '276956322', customerKey: 'KATO', grade: '6005C', size: '203 MM X 5800 MM', qtyMt: 40, netMt: 40.1, deliveryMonth: '2026-11', port: 'NAGOYA' }),
  rec({ orderId: 'o21', orderNo: 21, shipmentId: 's21', seqNo: 1, shipStatus: 'OPEN', bl: '198GX06445', customerKey: 'KATO', grade: '6063 HSB', size: '152 MM', qtyMt: 32, netMt: 29.2, deliveryMonth: '2026-11', port: 'NAGOYA' }),
  rec({ orderId: 'o22', orderNo: 22, shipmentId: 's22', seqNo: 1, shipStatus: 'OPEN', bl: '198GX06520', customerKey: 'KATO', grade: '6063', size: '203 MM', qtyMt: 40, netMt: 40.2, deliveryMonth: '2026-11', port: 'NAGOYA' }),
  rec({ orderId: 'o15', orderNo: 15, shipmentId: 's15', seqNo: 1, shipStatus: 'OPEN', bl: '198GX05383', customerKey: 'SUS', grade: '6063', qtyMt: 300, netMt: 300.4, deliveryMonth: '2026-10', port: 'YOKOHAMA' }),
];
const ev = (subject: string, body = ''): EmailEvidence => ({ subject, body, attachments: [], date: new Date('2026-10-20') });
const decide = (e: EmailEvidence, thread: Parameters<typeof decideMatch>[0]['thread']) => decideMatch({ ev: e, records: RECORDS, hits: findKeyHits(e, RECORDS), thread });

describe('decideMatch with the thread (round P)', () => {
  it('trace back: no key in this reply, the first email of the thread had the B/L → that shipment ("thread", traced, blocked b — confirm)', () => {
    const d = decide(ev('Re: 書類送付', 'thanks'), { accepted: null, traced: { orderId: 'o15', shipmentId: 's15', keyLabel: 'B/L 198GX05383', date: '2026-10-14' }, candidates: [] });
    expect(d).toMatchObject({ target: { orderId: 'o15', shipmentId: 's15' }, kind: 'thread', confidence: 'thread', threadFrom: 'traced', auto: false, keyLabel: 'B/L 198GX05383' });
    expect(d.reason).toBe('B/L 198GX05383 is in an earlier email of this thread (2026-10-14)');
    expect(d.blocked.some((b) => b.startsWith('b:'))).toBe(true);
  });
  it('trace back is dropped when the subject disagrees with the traced record ("check")', () => {
    const d = decide(ev('Re: 6005C 40T の件'), { accepted: null, traced: { orderId: 'o15', shipmentId: 's15', keyLabel: 'B/L 198GX05383', date: null }, candidates: [] });
    expect(d.target).toEqual({ orderId: 'o15', shipmentId: 's15' });
    expect(d.check.join(' ')).toMatch(/grade 6005 ≠ 6063/);
    expect(d.auto).toBe(false);
  });
  it('a key in THIS email wins over the thread', () => {
    const d = decide(ev('Re: 198GX06445 arrival'), { accepted: { orderId: 'o15', shipmentId: 's15' }, traced: null, candidates: [] });
    expect(d).toMatchObject({ target: { orderId: 'o21', shipmentId: 's21' }, confidence: 'exact', kind: 'bl' });
  });
  it('combined thread (Kato 6005C 40T / 6063 HSB 32T / 6063 40T): a reply naming one product follows that one; a reply naming none → "pick the shipment" with the candidates', () => {
    const cands = [
      { orderId: 'o20', shipmentId: 's20' },
      { orderId: 'o21', shipmentId: 's21' },
      { orderId: 'o22', shipmentId: 's22' },
    ];
    const one = decide(ev('Re: 【11月納入】アルミニウムビレット6063-6インチ 29T 通関・国内輸送'), { accepted: { orderId: 'o20', shipmentId: 's20' }, traced: null, candidates: cands });
    // Round V: the subject names the order itself (Nov · 6063 · 29 t ≈ #21's 32 t) — an order-level match, same target.
    expect(one).toMatchObject({ target: { orderId: 'o21', shipmentId: 's21' }, auto: false });
    expect(one.reason).toMatch(/#21/);
    const none = decide(ev('Re: 書類送付: アルミビレット11月納入分'), { accepted: { orderId: 'o20', shipmentId: 's20' }, traced: null, candidates: cands });
    expect(none.target).toBeNull();
    expect(none.multiOrderIds).toEqual(['o20', 'o21', 'o22']);
    expect(none.blocked).toContain('a: pick the shipment (thread covers #20-1/#21-1/#22-1)');
    // The subject naming SEVERAL products never follows one.
    const multi = decide(ev('Re: 【11月納入】6005C-8インチ 40T 6063ハイスピードビレット-6インチ 32T'), { accepted: null, traced: null, candidates: cands });
    expect(multi.target).toBeNull();
    expect(multi.multiOrderIds.length).toBe(3);
  });
  it('an accepted thread with one link: inherited; nothing in the thread: no match, with the reason', () => {
    expect(decide(ev('Re: 書類送付'), { accepted: { orderId: 'o22', shipmentId: 's22' }, traced: null, candidates: [{ orderId: 'o22', shipmentId: 's22' }] })).toMatchObject({ target: { orderId: 'o22', shipmentId: 's22' }, threadFrom: 'accepted', auto: true });
    const d = decide(ev('Re: 諸掛りについて'), null);
    expect(d.target).toBeNull();
    expect(d.reason).toMatch(/no record number/);
  });
});
