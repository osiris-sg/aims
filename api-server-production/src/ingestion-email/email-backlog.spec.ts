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

describe('history and no order', () => {
  it('conversation about a completed order / delivered shipment → HISTORY', () => {
    expect(classifyEmail(base({ target: t, confidence: 'exact', targetClosed: true }))).toMatchObject({ kind: 'HISTORY' });
    expect(classifyEmail(base({ target: t, confidence: 'exact', targetClosed: true, filesSomething: true, attachments: [{ name: 'x.pdf', slot: 'VENDOR_INVOICE' }] }))).toMatchObject({ kind: 'CONFIRM' });
  });
  it('no key, nothing in the thread, no subject match → NO_ORDER with a seed from the keys and the subject', () => {
    const v = classifyEmail(base({ subject: 'Re: Draft - Sales Contract- 6063- 50 tne', keys: { piNo: 'SIAE_PI_26100906', contractNo: null } }));
    expect(v.kind).toBe('NO_ORDER');
    expect(v.seed).toMatchObject({ piNo: 'SIAE_PI_26100906', grade: '6063' });
    const k = classifyEmail(base({ subject: '書類送付: 6005C材220MT 2026年11月納入分 ーアジアディールハブ', keys: { piNo: null, contractNo: '454003598' }, keyInAims: false }));
    expect(k.kind).toBe('NO_ORDER');
    expect(k.seed).toMatchObject({ contractNo: '454003598', grade: '6005', qtyMt: 220 });
    expect(orderSeed({ subject: '【11月納入】アルミニウムビレット 加藤 6063 40T', date: new Date('2026-10-20') })).toMatchObject({ grade: '6063', qtyMt: 40, customerKey: 'KATO', deliveryMonth: '2026-11' });
  });
  it('Unsure mail with nothing to go on stays "Is it a shipment?"; processed / hidden rows are left alone', () => {
    expect(classifyEmail(base({ inboxState: 'UNSURE', verdict: 'UNSURE', subject: '諸掛りについて' }))).toMatchObject({ kind: 'IS_SHIPMENT' });
    expect(classifyEmail(base({ inboxState: 'UNSURE', verdict: 'UNSURE', subject: 'Accepted: 三井倉庫様 打合せ' }))).toMatchObject({ kind: 'HIDE' });
    expect(classifyEmail(base({ inboxState: 'PROCESSED' })).reason).toBe('already processed');
    expect(classifyEmail(base({ inboxState: 'HIDDEN' })).kind).toBe('HIDE');
  });
});
