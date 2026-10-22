/**
 * Round W follow-up — the CI no. is ONE invoice's (Vedanta prints "XP2652102551 Invoice No." on each CI; the 9000… in the
 * file name is never printed), so a value stored on several shipments is a slip, not a key; and "50 tne" / "50 tonnes" /
 * "50MT" / "50 t" are quantities in subjects and order-form seeds.
 */
import { orderSeed } from './email-backlog';
import { findKeyHits, MatchRecord, productSegments, subjectCues } from './email-match.rules';

const rec = (o: Partial<MatchRecord> & Pick<MatchRecord, 'orderId' | 'orderNo'>): MatchRecord => ({ orderStatus: 'OPEN', shipmentId: null, seqNo: null, shipStatus: null, bl: null, piNo: null, ciNo: null, customerKey: null, customerName: null, grade: null, size: null, qtyMt: null, netMt: null, deliveryMonth: null, port: null, ...o });
const ev = (subject: string, body = '') => ({ subject, body, attachments: [], date: new Date('2026-10-22') });

describe('a CI no. shared by several shipments is not a key', () => {
  const RECORDS = [
    rec({ orderId: 'o18', orderNo: 18, shipmentId: 's18-2', seqNo: 2, shipStatus: 'OPEN', bl: '198GX06516', ciNo: 'XP2652102552' }),
    rec({ orderId: 'o19', orderNo: 19, shipmentId: 's19-1', seqNo: 1, shipStatus: 'OPEN', bl: '198GX06522', ciNo: 'XP2652102552' }),
    rec({ orderId: 'o21', orderNo: 21, shipmentId: 's21-1', seqNo: 1, shipStatus: 'OPEN', bl: '198GX06445', ciNo: 'XP2652102552' }),
    rec({ orderId: 'o11', orderNo: 11, shipmentId: 's11-1', seqNo: 1, shipStatus: 'COMPLETED', bl: '198GX04630', ciNo: 'XP2652101334' }),
  ];
  it('XP2652102552 on three shipments → no ci hit at all; XP2652101334 on one → a hit', () => {
    expect(findKeyHits(ev('Invoice XP2652102552', 'please find'), RECORDS).filter((h) => h.kind === 'ci')).toEqual([]);
    const one = findKeyHits(ev('Invoice XP2652101334', ''), RECORDS).filter((h) => h.kind === 'ci');
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ value: 'XP2652101334', shipmentId: 's11-1' });
  });
  it('a B/L in the same email still decides', () => {
    expect(findKeyHits(ev('Invoice XP2652102552 for 198GX06445', ''), RECORDS).map((h) => h.kind)).toEqual(['bl']);
  });
});

describe('tonnage units in subjects and order-form seeds', () => {
  it.each([
    ['Re: Draft - Sales Contract- 6063- 50 tne', 50],
    ['6063 50 tonnes for November', 50],
    ['6063 50MT', 50],
    ['6063 50 t', 50],
    ['6063 50 tons', 50],
    ['【11月納入】6005C-8インチ 40T 加藤', 40],
    ['6063 300トン', 300],
  ])('%s → %s t', (subject, qty) => {
    expect(subjectCues(subject).qtys).toEqual([qty]);
    expect(productSegments(subject)[0]?.qty).toBe(qty);
  });
  it('words starting with t are not units ("50 to", "50 the"); an inch mark is not a tonnage', () => {
    expect(subjectCues('6063 50 to Nagoya').qtys).toEqual([]);
    expect(subjectCues('6063 50 the billets').qtys).toEqual([]);
    expect(subjectCues('6063 8インチ 40T').qtys).toEqual([40]);
  });
  it('the SIAE seed reads "6063 · 50 t"', () => {
    expect(orderSeed({ subject: 'Re: Draft - Sales Contract- 6063- 50 tne', keys: { piNo: 'SIAE_PI_26100906' } })).toMatchObject({ grade: '6063', qtyMt: 50, piNo: 'SIAE_PI_26100906' });
  });
});
