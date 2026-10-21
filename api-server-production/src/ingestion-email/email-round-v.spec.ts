/**
 * Round V — the leftovers that were really existing orders (dummy fixtures, real numbers):
 *   1. order-level cues: customer + delivery month + grade + total qty → the ORDER; a multi-product subject → several orders
 *   2. an exact tonnage (3 decimals) unique across open shipments is a hard key
 *   3. attachments naming another record than the email's own key: the email links where its words point, the file goes where it names
 *   4. link-only replies follow the records their thread covers; contact details → General
 */
import { autoTier, decideMatch, EmailEvidence, findKeyHits, MatchRecord, orderCuesMatch, ownTextCues, productSegments, subjectCues } from './email-match.rules';
import { backlogAutoLabel, classifyEmail, BacklogInput } from './email-backlog';

const rec = (o: Partial<MatchRecord> & Pick<MatchRecord, 'orderId' | 'orderNo'>): MatchRecord => ({ orderStatus: 'OPEN', shipmentId: null, seqNo: null, shipStatus: null, bl: null, piNo: null, ciNo: null, customerKey: null, customerName: null, grade: null, size: null, qtyMt: null, netMt: null, deliveryMonth: null, port: null, ...o });
// The SUS October pair (#15 6063 300 t, #16 6005 120 t in two shipments), the SUS November pair (#18 6005 220 t in three, #19 6063 300 t in two), Kato Nov (#20, #22).
const RECORDS: MatchRecord[] = [
  rec({ orderId: 'o15', orderNo: 15, shipmentId: 's15-1', seqNo: 1, shipStatus: 'OPEN', bl: '198GX05383', customerKey: 'SUS', grade: '6063', size: '203 MM', qtyMt: 300, netMt: 305.949, deliveryMonth: '2026-10' }),
  rec({ orderId: 'o16', orderNo: 16, shipmentId: 's16-1', seqNo: 1, shipStatus: 'OPEN', bl: '198GX05781', customerKey: 'SUS', grade: '6005', size: '203 MM', qtyMt: 120, netMt: 96.908, deliveryMonth: '2026-10' }),
  rec({ orderId: 'o16', orderNo: 16, shipmentId: 's16-2', seqNo: 2, shipStatus: 'OPEN', bl: '198GX06003', customerKey: 'SUS', grade: '6005', size: '203 MM', qtyMt: 120, netMt: 20.414, deliveryMonth: '2026-10' }),
  rec({ orderId: 'o18', orderNo: 18, shipmentId: 's18-1', seqNo: 1, shipStatus: 'OPEN', bl: '198GX06322', customerKey: 'SUS', grade: '6005', size: '203 MM', qtyMt: 220, netMt: 183.693, deliveryMonth: '2026-11' }),
  rec({ orderId: 'o18', orderNo: 18, shipmentId: 's18-2', seqNo: 2, shipStatus: 'OPEN', bl: '198GX06516', customerKey: 'SUS', grade: '6005', size: '203 MM', qtyMt: 220, netMt: 20.416, deliveryMonth: '2026-11' }),
  rec({ orderId: 'o18', orderNo: 18, shipmentId: 's18-3', seqNo: 3, shipStatus: 'OPEN', bl: '198GX06524', customerKey: 'SUS', grade: '6005', size: '203 MM', qtyMt: 220, netMt: 17.861, deliveryMonth: '2026-11' }),
  rec({ orderId: 'o19', orderNo: 19, shipmentId: 's19-1', seqNo: 1, shipStatus: 'OPEN', bl: '198GX06522', customerKey: 'SUS', grade: '6063', size: '203 MM', qtyMt: 300, netMt: 281.919, deliveryMonth: '2026-11' }),
  rec({ orderId: 'o19', orderNo: 19, shipmentId: 's19-2', seqNo: 2, shipStatus: 'OPEN', bl: '198GX06523', customerKey: 'SUS', grade: '6063', size: '203 MM', qtyMt: 300, netMt: 15.296, deliveryMonth: '2026-11' }),
  rec({ orderId: 'o20', orderNo: 20, shipmentId: 's20-1', seqNo: 1, shipStatus: 'OPEN', bl: '276956322', customerKey: 'KATO', grade: '6005', size: '203 MM', qtyMt: 40, netMt: 35.72, deliveryMonth: '2026-11' }),
  rec({ orderId: 'o22', orderNo: 22, shipmentId: 's22-1', seqNo: 1, shipStatus: 'OPEN', bl: '198GX06520', customerKey: 'KATO', grade: '6063', size: '203 MM', qtyMt: 40, netMt: 40.271, deliveryMonth: '2026-11' }),
];
const ev = (subject: string, body = '', attachments: Array<{ name: string; text?: string }> = [], counterparty: string | null = 'SUS'): EmailEvidence => ({ subject, body, attachments: attachments.map((a) => ({ name: a.name, text: a.text ?? '' })), date: new Date('2026-10-20'), counterparty });
const decide = (e: EmailEvidence, thread: Parameters<typeof decideMatch>[0]['thread'] = null) => decideMatch({ ev: e, records: RECORDS, hits: findKeyHits(e, RECORDS), thread });

describe('round V, rule 1 — order-level cues', () => {
  it('reads product segments: "6005C材220MT", "6005Cー220t, 6063ー300t", and ignores the inch size', () => {
    expect(productSegments('書類送付: 6005C材220MT 2026年11月納入分')).toEqual([{ grade: '6005', qty: 220 }]);
    expect(productSegments('ビレット案件（11月納入6005Cー220t, 6063ー300t）')).toEqual([{ grade: '6005', qty: 220 }, { grade: '6063', qty: 300 }]);
    expect(productSegments('【11月納入】6005C-8インチ 40T 6063-8インチ 40T')).toEqual([{ grade: '6005', qty: 40 }, { grade: '6063', qty: 40 }]);
  });

  it('"6005C材220MT 2026年11月納入分" from SUS → order #18 (the subject names the order, not a shipment)', () => {
    const e = ev('Re: 書類送付: 6005C材220MT 2026年11月納入分 ーアジアディールハブ', 'ご確認ください。');
    const oc = orderCuesMatch(e, RECORDS, subjectCues(e.subject, e.date), ownTextCues('', RECORDS, e.date));
    expect(oc?.orders.map((o) => o.orderId)).toEqual(['o18']);
    const d = decide(e);
    expect(d.target).toEqual({ orderId: 'o18', shipmentId: null });
    expect(d.source).toBe('order-cues');
    expect(d.check).toEqual([]);
    expect(autoTier(d, null)).toBe('high');
  });

  it('"ビレット案件（11月納入6005Cー220t, 6063ー300t）" → #18 + #19 (links), not "pick"', () => {
    // Mitsui (the forwarder) has no customer word: month + grade + total qty still name the orders uniquely.
    const d = decide(ev('Re: ビレット案件（11月納入6005Cー220t, 6063ー300t）_アジアディールハブ', 'よろしくお願いします。\n\n> 以前: B/L 198GX06322 / 198GX06522', [], 'MITSUI_SOKO'));
    expect(d.links?.map((l) => l.orderId)).toEqual(['o18', 'o19']);
    const sus = decide(ev('Re: ビレット案件（11月納入6005Cー220t, 6063ー300t）_アジアディールハブ', 'よろしくお願いします。'));
    expect(sus.links?.map((l) => l.orderId)).toEqual(['o18', 'o19']);
    expect(sus.target).toBeNull();
    expect(sus.reason).toMatch(/several orders/);
  });

  it('"書類送付： 10月納入 ご希望日程" from SUS: customer + month only → both October orders; the own text naming 6063 only → #15', () => {
    const both = decide(ev('Re: 書類送付： 10月納入 ご希望日程', 'ご希望日程をお知らせください。'));
    expect(both.links?.map((l) => l.orderId).sort()).toEqual(['o15', 'o16']);
    const one = decide(ev('Re: 書類送付： 10月納入 ご希望日程', '6063 300t の納入日程は 10/20 でお願いします。'));
    expect(one.target).toEqual({ orderId: 'o15', shipmentId: 's15-1' });
    expect(one.source).toBe('order-cues');
  });

  it('no order of that customer / month / grade / qty → nothing (the SIAE draft contract 6063 50 t stays "No order yet")', () => {
    const d = decide(ev('Re: Draft - Sales Contract- 6063- 50 tne', 'please find the draft', [], 'OTHER'));
    expect(d.target).toBeNull();
    expect(d.links ?? []).toEqual([]);
  });
});

describe('round V, rule 2 — an exact tonnage is a hard key', () => {
  it('"11月納入6005Cー183.693T" → #18-1 (net 183.693, unique) as a high-tier key', () => {
    const e = ev('Re: 書類送付: 11月納入6005Cー183.693T_アジアディールハブ', 'ご確認ください。\n\n> B/L 198GX05781 / 198GX06322 / 198GX06524', [], 'MITSUI_SOKO');
    expect(findKeyHits(e, RECORDS).filter((h) => h.kind === 'net')).toEqual([expect.objectContaining({ value: '183.693', shipmentId: 's18-1', where: ['subject'] })]);
    const d = decide(e);
    expect(d.target).toEqual({ orderId: 'o18', shipmentId: 's18-1' });
    expect(d.source).toBe('subject');
    expect(d.keyLabel).toBe('net 183.693');
    expect(d.check).toEqual([]);
    expect(autoTier(d, null)).toBe('high');
  });

  it('a tonnage shared by two shipments, or with fewer than 3 decimals, is not a key', () => {
    const twin = [...RECORDS, rec({ orderId: 'o99', orderNo: 99, shipmentId: 's99', seqNo: 1, shipStatus: 'OPEN', netMt: 183.693, customerKey: 'KATO', grade: '6005', deliveryMonth: '2026-12' })];
    expect(findKeyHits(ev('183.693T'), twin).filter((h) => h.kind === 'net')).toEqual([]);
    expect(findKeyHits(ev('183.69T'), RECORDS).filter((h) => h.kind === 'net')).toEqual([]);
  });
});

describe('round V, rule 3 — attachments naming another record than the email', () => {
  it('Vedanta "Copy documents … 198GX06516" with a CI naming 198GX06522: the email → #18-2, the CI → #19-1, no conflict', () => {
    const d = decide(ev('RE: Copy documents - Asia Deal(Sus) //454003255 //198GX06516 // 20.416 MT', 'Please find the documents attached.\n\n> earlier: 198GX06520', [{ name: 'COMMERCIAL_INVOICE_9000586447.pdf', text: 'BL No. 198GX06522 net 281.919 MT' }], 'VEDANTA'));
    expect(d.target).toEqual({ orderId: 'o18', shipmentId: 's18-2' });
    expect(d.source).toBe('subject');
    expect(d.check).toEqual([]);
    expect(d.blocked.some((b) => /^d:/.test(b))).toBe(false);
    expect(d.notes.join(' ')).toMatch(/attachment names #19-1 — it files there/);
    expect(d.multiOrderIds).toEqual([]);
    expect(d.reason).toMatch(/corroborated by the subject/);
    expect(autoTier(d, null)).toBe('high');
  });
});

describe('round V, rule 4 — link-only replies and General messages', () => {
  const base = (o: Partial<BacklogInput>): BacklogInput => ({ inboxState: 'UNMATCHED', verdict: 'SHIPMENT', subject: 'Re: x', attachments: [], filesSomething: false, fillsSomething: false, target: null, confidence: 'none', check: [], multiOrderIds: [], wouldAuto: false, targetClosed: false, keyInAims: false, ...o });

  it('a reply with text but nothing to file on a combined thread follows the records the thread covers ("thread covers")', () => {
    const v = classifyEmail(base({ subject: 'Re: 【11月納入】6005C 40T 6063 32T 6063 40T', ownTextEmpty: false, threadLinks: [{ orderId: 'o20', shipmentId: 's20-1' }, { orderId: 'o22', shipmentId: 's22-1' }] }));
    expect(v.kind).toBe('INHERIT_THREAD');
    expect(v.reason).toMatch(/nothing to file/);
    expect(backlogAutoLabel('INHERIT_THREAD', null, 2)).toBe('thread covers');
    expect(backlogAutoLabel('INHERIT_THREAD', null, 1)).toBe('thread');
    // The same reply WITH a document to file still asks a person.
    expect(classifyEmail(base({ ownTextEmpty: false, filesSomething: true, attachments: [{ name: 'AN.pdf', slot: 'ARRIVAL_NOTICE' }], threadLinks: [{ orderId: 'o20', shipmentId: 's20-1' }, { orageId: 'o22' } as any] })).kind).not.toBe('INHERIT_THREAD');
  });

  it('a multi-product subject naming several orders: link-only → MULTI_LINK (all of them); with a file → PICK', () => {
    expect(classifyEmail(base({ links: [{ orderId: 'o18', shipmentId: null }, { orderId: 'o19', shipmentId: null }] })).kind).toBe('MULTI_LINK');
    expect(classifyEmail(base({ links: [{ orderId: 'o18', shipmentId: null }, { orderId: 'o19', shipmentId: null }], filesSomething: true, attachments: [{ name: 'plan.xlsx', slot: 'DELIVERY_SCHEDULE' }] })).kind).toBe('PICK');
  });

  it('"三井倉庫細江 連絡先" (contact details from Mitsui) → General (no shipment), not "is it a shipment?"', () => {
    const v = classifyEmail(base({ inboxState: 'UNSURE', verdict: 'UNSURE', subject: '三井倉庫細江 連絡先', counterparty: 'MITSUI_SOKO' }));
    expect(v.kind).toBe('GENERAL');
    expect(v.reason).toMatch(/contact \/ general message from MITSUI_SOKO/);
    expect(classifyEmail(base({ inboxState: 'UNSURE', verdict: 'UNSURE', subject: 'アルミインゴット輸入の件', counterparty: 'OTHER' })).kind).not.toBe('GENERAL');
  });
});
