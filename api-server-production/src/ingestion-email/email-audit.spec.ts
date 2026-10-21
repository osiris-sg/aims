/**
 * Round W — Part A: the audit comparator (stored link vs hard evidence vs the independent second pass) and the
 * two-source rule's owner examples.
 */
import { auditLink } from './email-audit';
import { autoTier, decideMatch, EmailEvidence, findKeyHits, KeyHit, MatchRecord } from './email-match.rules';
import { ReasonerJudgement } from './email-reasoner';

const rec = (o: Partial<MatchRecord> & Pick<MatchRecord, 'orderId' | 'orderNo'>): MatchRecord => ({ orderStatus: 'OPEN', shipmentId: null, seqNo: null, shipStatus: null, bl: null, piNo: null, ciNo: null, customerKey: null, customerName: null, grade: null, size: null, qtyMt: null, netMt: null, deliveryMonth: null, port: null, ...o });
const RECORDS: MatchRecord[] = [
  rec({ orderId: 'o18', orderNo: 18, shipmentId: 's18-2', seqNo: 2, shipStatus: 'OPEN', bl: '198GX06516', customerKey: 'SUS', grade: '6005', size: '203 MM', qtyMt: 220, netMt: 20.416, deliveryMonth: '2026-11' }),
  rec({ orderId: 'o19', orderNo: 19, shipmentId: 's19-1', seqNo: 1, shipStatus: 'OPEN', bl: '198GX06522', customerKey: 'SUS', grade: '6063', size: '203 MM', qtyMt: 300, netMt: 281.919, deliveryMonth: '2026-11' }),
  rec({ orderId: 'o9', orderNo: 9, shipmentId: 's9', seqNo: 1, shipStatus: 'COMPLETED', orderStatus: 'COMPLETED', bl: '198GX04630', customerKey: 'SUS', grade: '6063', qtyMt: 300, deliveryMonth: '2026-08' }),
];
const hit = (o: Partial<KeyHit> & Pick<KeyHit, 'orderId' | 'value'>): KeyHit => ({ kind: 'bl', shipmentId: null, where: ['attachment'], ...o });
const second = (o: Partial<ReasonerJudgement>): ReasonerJudgement => ({ apply: false, targets: [], evidence: 'e', reason: 'r', keyLabel: null, picks: [], isShipmentMail: true, ...o });
const base = { general: false, hits: [] as KeyHit[], orderCues: [] as Array<{ orderId: string }>, records: RECORDS };

describe('round W — the audit comparator', () => {
  it('AGREE when the second pass names the stored record (an order-level link covers its shipment)', () => {
    const r = auditLink({ ...base, current: [{ orderId: 'o19', shipmentId: 's19-1' }], second: second({ apply: true, targets: [{ orderId: 'o19', shipmentId: 's19-1', attachmentIndexes: [1], docTypes: { 1: 'CI' } }] }) });
    expect(r.verdict).toBe('AGREE');
    expect(r.currentRefs).toEqual(['#19-1']);
    expect(auditLink({ ...base, current: [{ orderId: 'o19', shipmentId: null }], second: second({ picks: [{ ref: '#19-1', orderId: 'o19', shipmentId: 's19-1', confidence: 'high', attachmentIndex: null, evidence: '' }] }) }).verdict).toBe('AGREE');
  });

  it('AGREE_WEAK: no confident answer but a hard key in the email supports the link; NO_ANSWER when nothing does', () => {
    const weak = auditLink({ ...base, current: [{ orderId: 'o18', shipmentId: 's18-2' }], hits: [hit({ orderId: 'o18', shipmentId: 's18-2', value: '198GX06516', where: ['subject'] })], second: second({}) });
    expect(weak.verdict).toBe('AGREE_WEAK');
    expect(weak.hardCurrent).toEqual(['B/L 198GX06516 (subject)']);
    expect(auditLink({ ...base, current: [{ orderId: 'o18', shipmentId: 's18-2' }], second: second({}) }).verdict).toBe('NO_ANSWER');
  });

  it('DISAGREE_CLEAR only when the second pass is verified by a hard key for ANOTHER record and nothing supports the current one', () => {
    const clear = auditLink({ ...base, current: [{ orderId: 'o18', shipmentId: 's18-2' }], hits: [hit({ orderId: 'o19', shipmentId: 's19-1', value: '198GX06522' })], second: second({ apply: true, targets: [{ orderId: 'o19', shipmentId: 's19-1', attachmentIndexes: [0], docTypes: { 0: 'CI' } }] }) });
    expect(clear.verdict).toBe('DISAGREE_CLEAR');
    expect(clear.move?.[0]).toMatchObject({ orderId: 'o19', shipmentId: 's19-1' });
    // The same, but the subject carries the current record's key too → a question, never moved by itself.
    const both = auditLink({ ...clear, ...base, current: [{ orderId: 'o18', shipmentId: 's18-2' }], hits: [hit({ orderId: 'o19', shipmentId: 's19-1', value: '198GX06522' }), hit({ orderId: 'o18', shipmentId: 's18-2', value: '198GX06516', where: ['subject'] })], second: second({ apply: true, targets: [{ orderId: 'o19', shipmentId: 's19-1', attachmentIndexes: [0], docTypes: { 0: 'CI' } }] }) });
    expect(both.verdict).toBe('DISAGREE_UNCLEAR');
    expect(both.move).toBeNull();
    // Unverified picks elsewhere → unclear.
    expect(auditLink({ ...base, current: [{ orderId: 'o18', shipmentId: 's18-2' }], second: second({ picks: [{ ref: '#19-1', orderId: 'o19', shipmentId: 's19-1', confidence: 'medium', attachmentIndex: null, evidence: '' }] }) }).verdict).toBe('DISAGREE_UNCLEAR');
  });

  it('"not shipment mail" on a linked email: a question unless a hard key supports the link; a General email is confirmed by it', () => {
    expect(auditLink({ ...base, current: [{ orderId: 'o18', shipmentId: 's18-2' }], second: second({ isShipmentMail: false }) }).verdict).toBe('DISAGREE_UNCLEAR');
    expect(auditLink({ ...base, current: [], general: true, second: second({ isShipmentMail: false }) }).verdict).toBe('AGREE');
    // A General email the second pass VERIFIES as a shipment's → a question.
    expect(auditLink({ ...base, current: [], general: true, second: second({ apply: true, targets: [{ orderId: 'o19', shipmentId: 's19-1', attachmentIndexes: [], docTypes: {} }] }) }).verdict).toBe('DISAGREE_UNCLEAR');
  });

  it('NOT_OPEN: a link to a closed record is skipped (the second pass only sees open records)', () => {
    expect(auditLink({ ...base, current: [{ orderId: 'o9', shipmentId: 's9' }], second: second({}) }).verdict).toBe('NOT_OPEN');
  });
});

describe("round W, rule 3 — the owner's two-source examples", () => {
  const ev = (subject: string, body = '', attachments: Array<{ name: string; text?: string }> = []): EmailEvidence => ({ subject, body, attachments: attachments.map((a) => ({ name: a.name, text: a.text ?? '' })), date: new Date('2026-10-22'), counterparty: 'SUS' });
  const decide = (e: EmailEvidence, thread: Parameters<typeof decideMatch>[0]['thread'] = null) => decideMatch({ ev: e, records: RECORDS, hits: findKeyHits(e, RECORDS), thread });
  const T19 = { accepted: { orderId: 'o19', shipmentId: 's19-1' }, traced: null, candidates: [{ orderId: 'o19', shipmentId: 's19-1' }] };

  it('attachment key + own-text key → auto; attachment key alone → suggestion', () => {
    const two = decide(ev('Re: documents', 'Please find the CI for 198GX06522.', [{ name: 'CI.pdf', text: 'B/L 198GX06522 net 281.919' }]));
    expect(two.sources).toEqual(['attachment', 'own-text']);
    expect(autoTier(two, null)).toBe('high');
    const one = decide(ev('Re: documents', 'Please find attached.', [{ name: 'CI.pdf', text: 'B/L 198GX06522' }]));
    expect(one.sources).toEqual(['attachment']);
    expect(autoTier(one, null)).toBeNull();
  });

  it('own-text key + thread → auto; order-level cues + thread → auto (medium); each alone → suggestion', () => {
    const keyThread = decide(ev('Re: 11月納入', '198GX06522 の件です。'), T19);
    expect(keyThread.sources).toEqual(['own-text', 'thread']);
    expect(autoTier(keyThread, T19)).toBe('high');
    const cuesAlone = decide(ev('6063材300MT 2026年11月納入分', 'よろしくお願いします。'));
    expect(cuesAlone.source).toBe('order-cues');
    expect(autoTier(cuesAlone, null)).toBeNull();
    expect(autoTier(cuesAlone, T19)).toBe('medium');
  });
});
