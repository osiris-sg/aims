/** Round Q: the backlog classifier — conversation-only auto-link, calendar / auto-reply hide, history link, no-order grouping. */
import { classifyEmail, conversationOnly, hideReason, orderSeed, BacklogInput } from './email-backlog';

const base = (o: Partial<BacklogInput> = {}): BacklogInput => ({
  inboxState: 'UNMATCHED',
  verdict: 'SHIPMENT',
  subject: 'Re: 10/16 朝 ビレット 納品明細',
  attachments: [],
  filesSomething: false,
  fillsSomething: false,
  target: null,
  confidence: 'none',
  check: [],
  multiOrderIds: [],
  wouldAuto: false,
  targetClosed: false,
  keyInAims: false,
  keys: null,
  date: new Date('2026-10-20'),
  ...o,
});
const t = { orderId: 'o15', shipmentId: 's15' };

describe('obvious non-shipment mail is hidden, not purged', () => {
  it('calendar responses / invites (incl. .ics only), auto-replies / out of office, newsletters', () => {
    expect(hideReason('Accepted: 三井倉庫様 ディテンションについて @ 2026年 10月 20日')).toBe('calendar response');
    expect(hideReason('承諾: 打合せ')).toBe('calendar response');
    expect(hideReason('Invitation: Weekly sync')).toBe('meeting invite');
    expect(hideReason('Weekly sync', [{ name: 'invite.ics' }])).toBe('meeting invite');
    expect(hideReason('不在のご連絡 Re: ビレット案件（10月納入6005ー120t）')).toBe('auto-reply / out of office');
    expect(hideReason('Automatic reply: 書類送付')).toBe('auto-reply / out of office');
    // A date / time prefix (prod, 2026-10-21) and the MIME's own say-so.
    expect(hideReason('10/21 15:00~不在のご連絡 Re: 【11月納入】アルミニウムビレット6005C-8インチ 40T')).toBe('auto-reply / out of office');
    expect(hideReason('Re: 【11月納入】アルミニウムビレット', [], { autoSubmitted: true })).toBe('auto-reply / out of office (auto-submitted)');
    expect(classifyEmail(base({ subject: 'Re: 書類送付', autoSubmitted: true, target: t, confidence: 'exact' })).kind).toBe('HIDE');
    expect(hideReason('Aluminium market newsletter — October')).toBe('newsletter');
    expect(hideReason('Re: 10/16 朝 ビレット 納品明細', [{ name: 'COA.pdf' }])).toBeNull();
    expect(hideReason('Re: 書類送付', [{ name: 'invite.ics' }, { name: 'PL.pdf' }])).toBeNull();
    expect(classifyEmail(base({ subject: 'Accepted: 三井倉庫様 ディテンションについて', target: t, confidence: 'exact' }))).toMatchObject({ kind: 'HIDE', reason: 'calendar response' });
  });
});

describe('conversation only → linked by itself', () => {
  it('no attachment maps to a document slot, nothing to fill, one clear record (key, thread or subject) → AUTO_LINK', () => {
    expect(conversationOnly(base({ attachments: [{ name: 'signature.png', slot: null }] }))).toBe(true);
    expect(conversationOnly(base({ attachments: [{ name: 'COA.pdf', slot: 'COA' }] }))).toBe(false);
    expect(conversationOnly(base({ fillsSomething: true }))).toBe(false);
    expect(classifyEmail(base({ target: t, confidence: 'thread' }))).toMatchObject({ kind: 'AUTO_LINK' });
    expect(classifyEmail(base({ target: t, confidence: 'cues' }))).toMatchObject({ kind: 'AUTO_LINK', reason: 'conversation only, one shipment (cues)' });
    expect(classifyEmail(base({ target: { orderId: 'o15', shipmentId: null }, confidence: 'exact' }))).toMatchObject({ kind: 'AUTO_LINK', reason: 'conversation only, one order (exact)' });
  });
  it('a conflict or several candidates → a person picks; with documents → Confirm (or AUTO when the guards pass)', () => {
    expect(classifyEmail(base({ target: t, confidence: 'exact', check: ['grade 6005 ≠ 6063'] }))).toMatchObject({ kind: 'PICK' });
    expect(classifyEmail(base({ target: t, confidence: 'exact', check: ['grade 6005 ≠ 6063'], filesSomething: true, attachments: [{ name: 'AN.pdf', slot: 'ARRIVAL_NOTICE' }] }))).toMatchObject({ kind: 'CONFIRM' });
    expect(classifyEmail(base({ multiOrderIds: ['o20', 'o21', 'o22'] }))).toMatchObject({ kind: 'PICK', reason: 'several orders / shipments fit' });
    expect(classifyEmail(base({ target: t, confidence: 'exact', filesSomething: true, attachments: [{ name: 'COA.pdf', slot: 'COA' }] }))).toMatchObject({ kind: 'CONFIRM', reason: 'files documents' });
    expect(classifyEmail(base({ target: t, confidence: 'exact', filesSomething: true, attachments: [{ name: 'COA.pdf', slot: 'COA' }], wouldAuto: true }))).toMatchObject({ kind: 'AUTO' });
    // An attachment that maps to a slot but is not planned (e.g. a duplicate) still means "not conversation only".
    expect(classifyEmail(base({ target: t, confidence: 'exact', attachments: [{ name: 'COA.pdf', slot: 'COA' }] }))).toMatchObject({ kind: 'CONFIRM' });
  });
});

describe('round R follow-up: empty, general, inherit the thread, multi-link a schedule', () => {
  it('an empty email (no subject, no own text, no attachment) is hidden', () => {
    expect(classifyEmail(base({ subject: '', ownTextEmpty: true }))).toMatchObject({ kind: 'HIDE', reason: 'empty email' });
    expect(classifyEmail(base({ subject: '', ownTextEmpty: true, unhidden: true })).kind).not.toBe('HIDE');
  });
  it('a customer-level price / cost sheet with no record reference → GENERAL, linked to the customer only', () => {
    const v = classifyEmail(base({ inboxState: 'UNSURE', verdict: 'UNSURE', subject: '諸掛りについて', customerKey: 'SUS', attachments: [{ name: '価格推移.xlsx', slot: null }], attachmentTexts: [{ name: '価格推移.xlsx', text: 'ビレット価格推移（32～35期） 諸掛り 通関/送料' }] }));
    expect(v).toMatchObject({ kind: 'GENERAL' });
    expect(v.reason).toMatch(/price \/ cost sheet/);
    // The same sheet from a supplier / unknown party, or with a record key, is not General.
    expect(classifyEmail(base({ subject: '諸掛りについて', customerKey: null, attachments: [{ name: '価格推移.xlsx', slot: null }], attachmentTexts: [{ name: '価格推移.xlsx', text: '価格推移' }] })).kind).not.toBe('GENERAL');
    expect(classifyEmail(base({ subject: '諸掛りについて', customerKey: 'SUS', keyInAims: true, attachments: [{ name: '価格推移.xlsx', slot: null }], attachmentTexts: [{ name: '価格推移.xlsx', text: '価格推移' }] })).kind).not.toBe('GENERAL');
  });
  it('a reply with no text of its own and nothing attached follows the thread\'s links (all of them for a combined thread)', () => {
    const links = [{ orderId: 'o20', shipmentId: 's20' }, { orderId: 'o21', shipmentId: 's21' }, { orderId: 'o22', shipmentId: 's22' }];
    const v = classifyEmail(base({ subject: 'Re: 【11月納入】…', ownTextEmpty: true, threadLinks: links, multiOrderIds: ['o20', 'o21', 'o22'] }));
    expect(v).toMatchObject({ kind: 'INHERIT_THREAD' });
    expect(v.reason).toMatch(/3 link/);
    // With its own text it is judged on that text instead.
    // Round V: a reply WITH text but nothing to file still follows the thread (link-only is never Unprocessed); one that files asks a person.
    expect(classifyEmail(base({ subject: 'Re: 【11月納入】…', ownTextEmpty: false, threadLinks: links, multiOrderIds: ['o20', 'o21', 'o22'] })).kind).toBe('INHERIT_THREAD');
    expect(classifyEmail(base({ subject: 'Re: 【11月納入】…', ownTextEmpty: false, filesSomething: true, attachments: [{ name: 'AN.pdf', slot: 'ARRIVAL_NOTICE' }], threadLinks: links, multiOrderIds: ['o20', 'o21', 'o22'] })).kind).toBe('PICK');
  });
  it('a schedule sheet covering several candidate shipments → MULTI_LINK (linked to all, nothing filed)', () => {
    const cands = [{ orderId: 'o15', shipmentId: 's15', ref: '#15-1' }, { orderId: 'o16', shipmentId: 's16a', ref: '#16-1' }, { orderId: 'o16', shipmentId: 's16b', ref: '#16-2' }];
    const v = classifyEmail(base({ subject: 'Re: ビレット案件（10月納入6005ー20t, 6063ー300t）', candidates: cands, attachments: [{ name: '10月SUS納入予定.xlsx', slot: 'CUSTOMER_PL' }], attachmentTexts: [{ name: '10月SUS納入予定.xlsx', text: 'ETA FT LOT コンテナ番号 納品日' }] }));
    expect(v).toMatchObject({ kind: 'MULTI_LINK' });
    expect(v.reason).toMatch(/#15-1 \/ #16-1 \/ #16-2/);
    expect(classifyEmail(base({ subject: 'x', candidates: cands.slice(0, 1), attachments: [{ name: '10月SUS納入予定.xlsx', slot: null }], attachmentTexts: [{ name: '10月SUS納入予定.xlsx', text: 'ETA' }] })).kind).not.toBe('MULTI_LINK');
  });
});

describe('history and no order', () => {
  it('conversation about a completed order / delivered shipment → HISTORY', () => {
    expect(classifyEmail(base({ target: t, confidence: 'exact', targetClosed: true }))).toMatchObject({ kind: 'HISTORY' });
    expect(classifyEmail(base({ target: t, confidence: 'exact', targetClosed: true, filesSomething: true, attachments: [{ name: 'x.pdf', slot: 'VENDOR_INVOICE' }] }))).toMatchObject({ kind: 'CONFIRM' });
  });
  it('no key, nothing in the thread, no subject match → NO_ORDER with a seed from the keys and the subject', () => {
    const v = classifyEmail(base({ subject: 'Re: Draft - Sales Contract- 6063- 50 tne', keys: { piNo: 'SIAE_PI_26100906', contractNo: null } }));
    expect(v.kind).toBe('NO_ORDER');
    expect(v.seed).toMatchObject({ piNo: 'SIAE_PI_26100906', grade: '6063', qtyMt: 50 }); // "50 tne" is a quantity (round W follow-up)
    const k = classifyEmail(base({ subject: '書類送付: 6005C材220MT 2026年11月納入分 ーアジアディールハブ', keys: { piNo: null, contractNo: '454003598' }, keyInAims: false }));
    expect(k.kind).toBe('NO_ORDER');
    expect(k.seed).toMatchObject({ contractNo: '454003598', grade: '6005', qtyMt: 220 });
    expect(orderSeed({ subject: '【11月納入】アルミニウムビレット 加藤 6063 40T', date: new Date('2026-10-20') })).toMatchObject({ grade: '6063', qtyMt: 40, customerKey: 'KATO', deliveryMonth: '2026-11' });
  });
  it('round X: an email with a known key is NEVER a new-deal / is-it-a-shipment card — keys only in the quoted text → pick the shipment', () => {
    const quoted = [{ orderId: 'o15', shipmentId: 's15-1', ref: '#15-1' }, { orderId: 'o16', shipmentId: 's16-1', ref: '#16-1' }];
    const v = classifyEmail(base({ subject: 'RE: Request for Extension of Detention Free Time for Japan WANHAI Shipments', keys: { piNo: null, contractNo: null }, quotedRecords: quoted }));
    expect(v.kind).toBe('PICK');
    expect(v.reason).toContain('#15-1, #16-1');
    expect(v.links).toEqual([{ orderId: 'o15', shipmentId: 's15-1' }, { orderId: 'o16', shipmentId: 's16-1' }]);
    expect(classifyEmail(base({ inboxState: 'UNSURE', verdict: 'UNSURE', subject: 'MOVO manual', quotedRecords: quoted })).kind).toBe('PICK');
    expect(classifyEmail(base({ subject: 'x', keyInAims: true })).kind).toBe('PICK');
    expect(classifyEmail(base({ subject: 'x', keyInAims: true })).kind).not.toBe('NO_ORDER');
    // A reply about DET costs naming 6005C: the cue candidates are the options, never a new deal.
    const det = classifyEmail(base({ subject: 'Re:【ご相談】直近のDET費用及びディテンション回避策について', verdict: 'SHIPMENT', cueCandidates: [{ orderId: 'o16', shipmentId: 's16-1', ref: '#16-1' }, { orderId: 'o16', shipmentId: 's16-2', ref: '#16-2' }] }));
    expect(det.kind).toBe('PICK');
    expect(det.links).toHaveLength(2);
    expect(classifyEmail(base({ subject: 'Re: DET costs', verdict: 'SHIPMENT' })).kind).toBe('PICK');
    // An import enquiry that is not a reply is a possible new deal, even when the AI was unsure.
    expect(classifyEmail(base({ subject: 'アルミインゴット輸入の件', inboxState: 'UNSURE', verdict: 'UNSURE' })).kind).toBe('NO_ORDER');
    // The replies of that new-deal thread stay a new deal (no earlier link in the thread), even with loose cues.
    expect(classifyEmail(base({ subject: 'RE: アルミインゴット輸入の件', verdict: 'SHIPMENT', cueCandidates: [{ orderId: 'o13', shipmentId: 's13-1', ref: '#13-1' }] })).kind).toBe('NO_ORDER');
    expect(classifyEmail(base({ subject: 'Re: Draft - Sales Contract- 6063- 50 tne', keys: { piNo: 'SIAE_PI_26100906', contractNo: null } })).kind).toBe('NO_ORDER');
  });
  it('Unsure mail with nothing to go on stays "Is it a shipment?"; processed / hidden rows are left alone', () => {
    expect(classifyEmail(base({ inboxState: 'UNSURE', verdict: 'UNSURE', subject: '諸掛りについて' }))).toMatchObject({ kind: 'IS_SHIPMENT' });
    expect(classifyEmail(base({ inboxState: 'UNSURE', verdict: 'UNSURE', subject: 'Accepted: 三井倉庫様 打合せ' }))).toMatchObject({ kind: 'HIDE' });
    expect(classifyEmail(base({ inboxState: 'PROCESSED' })).reason).toBe('already processed');
    expect(classifyEmail(base({ inboxState: 'HIDDEN' })).kind).toBe('HIDE');
  });
});
