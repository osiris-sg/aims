/**
 * Guarded email matching (2026-10, after the hand review of the 18 prod suggestions). Fixtures use the real
 * numbers (B/Ls, Maersk 276956322) with dummy content — never real email text.
 */
import { attachmentHits, attachmentTarget, cueConflicts, decideMatch, EmailEvidence, findKeyHits, MatchRecord, subjectCues, telexTiedTo, validCiNo, validContractNo } from './email-match.rules';
import { knownSender, mergeKeys, sanitizeKeys } from './email-triage.rules';

const rec = (o: Partial<MatchRecord> & Pick<MatchRecord, 'orderId' | 'orderNo'>): MatchRecord => ({
  orderStatus: 'OPEN',
  shipmentId: null,
  seqNo: null,
  shipStatus: null,
  bl: null,
  piNo: null,
  ciNo: null,
  customerKey: null,
  customerName: null,
  grade: null,
  size: null,
  qtyMt: null,
  netMt: null,
  deliveryMonth: null,
  port: null,
  ...o,
});
// Kato: #20 6005 40 t (Maersk 276956322, Nov), #21 6063 HSB 32 t (198GX06445, Nov), #22 6063 40 t (198GX06520, Nov), #25 6005 40 t (Dec, no shipment).
const RECORDS: MatchRecord[] = [
  rec({ orderId: 'o20', orderNo: 20, shipmentId: 's20', seqNo: 1, shipStatus: 'OPEN', bl: '276956322', customerKey: 'KATO', grade: '6005', size: '203 MM X 5800 MM', qtyMt: 40, netMt: 40.1, deliveryMonth: '2026-11', port: 'NAGOYA' }),
  rec({ orderId: 'o21', orderNo: 21, shipmentId: 's21', seqNo: 1, shipStatus: 'OPEN', bl: '198GX06445', customerKey: 'KATO', grade: '6063 HSB', size: '152 MM', qtyMt: 32, netMt: 29.2, deliveryMonth: '2026-11', port: 'NAGOYA' }),
  rec({ orderId: 'o22', orderNo: 22, shipmentId: 's22', seqNo: 1, shipStatus: 'OPEN', bl: '198GX06520', customerKey: 'KATO', grade: '6063', size: '203 MM', qtyMt: 40, netMt: 40.2, deliveryMonth: '2026-11', port: 'NAGOYA' }),
  rec({ orderId: 'o25', orderNo: 25, customerKey: 'KATO', grade: '6005', size: '203 MM', qtyMt: 40, deliveryMonth: '2026-12' }),
  rec({ orderId: 'o15', orderNo: 15, shipmentId: 's15', seqNo: 1, shipStatus: 'OPEN', bl: '198GX05383', ciNo: '9000565680', customerKey: 'SUS', grade: '6063', qtyMt: 300, netMt: 300.4, deliveryMonth: '2026-10', port: 'YOKOHAMA' }),
];
const ev = (subject: string, body = '', attachments: Array<{ name: string; text?: string }> = []): EmailEvidence => ({
  subject,
  body,
  attachments: attachments.map((a) => ({ name: a.name, text: a.text ?? '' })),
  date: new Date('2026-10-20'),
});
const decide = (e: EmailEvidence, thread: { orderId: string; shipmentId: string | null } | null = null) => decideMatch({ ev: e, records: RECORDS, hits: findKeyHits(e, RECORDS), thread });

describe('guard a — exactly one exact key to one record', () => {
  it('a B/L in the subject → that shipment, auto', () => {
    const d = decide(ev('JPYOK_DebitNote-198GX05383-20261020'));
    expect(d).toMatchObject({ target: { orderId: 'o15', shipmentId: 's15' }, kind: 'bl', confidence: 'exact', auto: true, keyLabel: 'B/L 198GX05383' });
  });
  it('the B/L inside a prefix (22AA198GX06445) still counts; a longer number does not', () => {
    expect(findKeyHits(ev('22AA198GX06445'), RECORDS).map((h) => h.orderId)).toEqual(['o21']);
    expect(findKeyHits(ev('ref 2769563221'), RECORDS)).toEqual([]);
  });
  it('no record key → never auto (subject cues alone)', () => {
    const d = decide(ev('【12月納入】6005-8インチ 40T 加藤軽金属様'));
    expect(d).toMatchObject({ target: { orderId: 'o25' }, kind: 'cues', confidence: 'cues', auto: false });
    expect(d.blocked[0]).toMatch(/^a:/);
  });
});

describe('guard b — the key in the subject or an attachment, not only the body', () => {
  it('a B/L only in the body → a suggestion', () => {
    const d = decide(ev('Re: 通関・国内輸送', '> previous mail: B/L 198GX06520 …'));
    expect(d.target).toEqual({ orderId: 'o22', shipmentId: 's22' });
    expect(d.auto).toBe(false);
    expect(d.blocked).toContainEqual(expect.stringMatching(/^b: B\/L 198GX06520/));
  });
  it('a B/L in an attachment (its name or text) counts', () => {
    const d = decide(ev('書類', '', [{ name: 'COMMERCIAL_INVOICE.pdf', text: 'B/L No. 198GX06520' }]));
    expect(d.auto).toBe(true);
  });
});

describe('guard c — the subject agrees (the real 6005C / 06445 case)', () => {
  // "【11月納入】…6005C-8インチ 40T…" whose quoted thread carries #21's 198GX06445 and #22's 198GX06520; #20's Maersk B/L in the body.
  const e = ev('Re: 【11月納入】アルミニウムビレット6005C-8インチ 40T 通関・国内輸送（名古屋港→ 加藤軽金属様', 'dummy\n> earlier: 198GX06445 / 198GX06520\nMaersk 276956322', []);
  it('the quoted 6063 B/Ls are dropped; #20-1 (Kato 6005 40 t, Nov) is the match — a suggestion with "check"', () => {
    const d = decide(e);
    expect(d.target).toEqual({ orderId: 'o20', shipmentId: 's20' });
    expect(d.auto).toBe(false);
    expect(d.check.join(' ')).toMatch(/ignored B\/L 198GX06445/);
  });
  it('cue conflicts: grade / qty / delivery month / customer', () => {
    const c = subjectCues('【11月納入】6005C-8インチ 40T 加藤', new Date('2026-10-20'));
    expect(c).toMatchObject({ months: ['2026-11'], grades: ['6005'], inches: [8], qtys: [40], customers: ['KATO'], multi: false });
    expect(cueConflicts(c, RECORDS[0])).toEqual([]);
    expect(cueConflicts(c, RECORDS[1])).toEqual(expect.arrayContaining([expect.stringMatching(/^grade/), expect.stringMatching(/^size/)]));
    expect(cueConflicts(c, RECORDS[3])).toEqual([expect.stringMatching(/^delivery 2026-11 ≠ 2026-12/)]);
  });
  it('a B/L in the subject whose order the subject contradicts → "check", not auto', () => {
    const d = decide(ev('198GX06520 6005C 40T'));
    expect(d.target?.orderId).toBe('o22');
    expect(d.auto).toBe(false);
    expect(d.blocked).toContainEqual(expect.stringMatching(/^c: the subject disagrees/));
  });
});

describe('guard d — no other order in the email', () => {
  it('the combined thread (6005C 40T / 6063 HSB 32T / 6063 40T) with three B/Ls → multi-order, check', () => {
    const d = decide(ev('Re: 【11月納入】6005C-8インチ 40T 6063ハイスピードビレット-6インチ 32T', 'dummy 276956322 198GX06445 198GX06520'));
    expect(d.target).toBeNull();
    expect(d.multiOrderIds.sort()).toEqual(['o20', 'o21', 'o22']);
    expect(d.auto).toBe(false);
    expect(d.check.join(' ')).toMatch(/several/);
  });
  it('one order in the subject, another quoted below → that order, but not auto', () => {
    const d = decide(ev('198GX05383 debit note', '> also about 198GX06520'));
    expect(d.target?.orderId).toBe('o15');
    expect(d.auto).toBe(false);
    expect(d.blocked).toContainEqual(expect.stringMatching(/^d:/));
  });
});

describe('thread follow', () => {
  it('no key: an accepted earlier email of the thread → its order ("thread"); auto only link-only (the service checks the plan), never when the subject disagrees', () => {
    const d = decide(ev('Re: 書類送付', 'thanks'), { orderId: 'o22', shipmentId: 's22' });
    expect(d).toMatchObject({ target: { orderId: 'o22', shipmentId: 's22' }, kind: 'thread', confidence: 'thread', auto: true, threadFrom: 'accepted' });
    expect(d.reason).toMatch(/earlier email of this thread/);
  });
});

describe('extraction validation', () => {
  it('CI no.: supplier formats only — not our SG-JP no., not a carrier debit note', () => {
    expect(validCiNo('XP2652101334')).toBe('XP2652101334');
    expect(validCiNo('9000565680')).toBe('9000565680');
    expect(validCiNo('YOK-20261020-53')).toBeNull();
    expect(validCiNo('ADH20260928-')).toBeNull();
    expect(validCiNo('JPYOK_DebitNote-198GX05383')).toBeNull();
    expect(validCiNo('INA-12345', ['^INA-\\d{5}$'])).toBe('INA-12345');
  });
  it('contract no. 4540xxxxx only — never a B/L; B/L keys as their core', () => {
    expect(validContractNo('454003598')).toBe('454003598');
    expect(validContractNo('22AA198GX06003')).toBeNull();
    const k = sanitizeKeys({ ...mergeKeys(null, {}), ciNo: 'ADH20260928-', contractNo: '22AA198GX06003', blNo: '22AA198GX06003' });
    expect(k).toMatchObject({ ciNo: null, contractNo: null, blNo: '198GX06003' });
  });
  it('carrier debit notes → VENDOR_INVOICE (step 12), never a CI', () => {
    const hit = knownSender({ from: 'ysa@wanhai.com', subject: 'Fw: JPYOK_DebitNote-198GX05383-20261020', attachments: [{ name: 'JPYOK_DebitNote-198GX05383-20261020.pdf' }] })!;
    expect(hit.rule).toBe('CARRIER_CHARGES');
    expect(hit.attachmentTypes).toEqual({ 'JPYOK_DebitNote-198GX05383-20261020.pdf': 'VENDOR_INVOICE' });
    expect(hit.forbidTypes).toContain('CI');
    expect(knownSender({ from: 'x@mitsui-soko.co.jp', subject: 'ディテンション請求', attachments: [{ name: 'detention.pdf' }] })!.rule).toBe('CARRIER_CHARGES');
  });
  it('telex code only with its B/L (same line / the subject)', () => {
    const one = ev('Re: telex', 'B/L 198GX06520 telex release code RINVIZ026A142');
    expect(telexTiedTo(one, 'RINVIZ026A142', '198GX06520')).toBe(true);
    const many = ev('Re: 6005C / 6063', 'codes:\nRINVIZ026A142\n\nB/Ls 198GX06445 198GX06520');
    expect(telexTiedTo(many, 'RINVIZ026A142', '198GX06520')).toBe(false);
    expect(telexTiedTo(ev('telex RINVIZ026A142'), 'RINVIZ026A142', '198GX06520')).toBe(true);
  });
});

describe('round R: own text vs quoted history, per-attachment keys', () => {
  it("a B/L in the email's OWN text is strong (guard b passes); only in the quoted history it stays weak", () => {
    const own = decide(ev('Re: 納期の件', '22AA198GX06445 本件の許可書を送付いたします。'));
    expect(own).toMatchObject({ target: { orderId: 'o21', shipmentId: 's21' }, confidence: 'exact', auto: true });
    expect(own.reason).toMatch(/email text/);
    const quoted = decide(ev('Re: 納期の件', 'ありがとうございます。\n> B/L 198GX06445 の件'));
    expect(quoted.target).toEqual({ orderId: 'o21', shipmentId: 's21' });
    expect(quoted.blocked).toContainEqual(expect.stringMatching(/^b:/));
  });
  it('each attachment\'s own content names its shipment', () => {
    const e = ev('RE: 書類送付 11月納入分', 'see attached', [
      { name: 'COA_HSB.pdf', text: 'B/L 22AA198GX06445' },
      { name: 'PL_6063.pdf', text: 'B/L 198GX06520' },
      { name: 'signature.png', text: '' },
    ]);
    const per = attachmentHits(e, RECORDS);
    expect(attachmentTarget(per[0].hits)).toMatchObject({ orderId: 'o21', shipmentId: 's21', keyLabel: 'B/L 198GX06445' });
    expect(attachmentTarget(per[1].hits)).toMatchObject({ orderId: 'o22', shipmentId: 's22' });
    expect(attachmentTarget(per[2].hits)).toBeNull();
  });
});
