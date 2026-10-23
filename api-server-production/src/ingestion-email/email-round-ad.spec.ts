/**
 * Round AD (2026-10-23, owner: "why are these still questions?") — the five prod cases, pure:
 *   1. exact tonnages of two shipments in the subject + a B/L in the text → the email names several records → a
 *      link-only reply links to all of them by itself
 *   2. an order matched by subject + thread with a delivery-schedule sheet → linked to the order's live shipments
 *   3. three warehouse invoices each naming its B/L + the subject naming both orders → two sources per attachment
 *   4. a detention request with nothing to file that quotes every Wan Hai B/L → linked to all of them
 *   5. a telex with the B/L in the subject: the code fills; the second pass naming MORE B/Ls is not a doubt
 */
import { auditLink } from './email-audit';
import { classifyEmail, multiLinkLabel } from './email-backlog';
import { decideMatch, EmailEvidence, findKeyHits, MatchRecord, telexTiedTo } from './email-match.rules';
import { isInlineImage, summaryTooLong } from './email-triage.rules';

const rec = (orderNo: number, seqNo: number | null, o: Partial<MatchRecord> = {}): MatchRecord => ({
  orderId: `o${orderNo}`,
  orderNo,
  orderStatus: 'OPEN',
  shipmentId: seqNo ? `s${orderNo}-${seqNo}` : null,
  seqNo,
  shipStatus: seqNo ? 'OPEN' : null,
  piNo: null,
  customerKey: 'SUS',
  customerName: null,
  grade: '6005',
  size: null,
  qtyMt: 220,
  deliveryMonth: '2026-11',
  bl: null,
  ciNo: null,
  netMt: null,
  port: 'YOKOHAMA',
  ...o,
});
/** The prod records behind the five cases (23 Oct). */
const RECORDS: MatchRecord[] = [
  rec(15, 1, { grade: '6063', qtyMt: 300, deliveryMonth: '2026-10', bl: '198GX05383', netMt: 305.949 }),
  rec(16, 1, { grade: '6005', qtyMt: 120, deliveryMonth: '2026-10', bl: '198GX05781', netMt: 96.908 }),
  rec(16, 2, { grade: '6005', qtyMt: 120, deliveryMonth: '2026-10', bl: '198GX06003', netMt: 20.414 }),
  rec(18, 1, { bl: '198GX06322', netMt: 183.693 }),
  rec(18, 2, { bl: '198GX06516', netMt: 20.416 }),
  rec(18, 3, { bl: '198GX06524', netMt: 17.861 }),
  rec(19, 1, { grade: '6063', qtyMt: 300, bl: '198GX06522', netMt: 281.919 }),
  rec(19, 2, { grade: '6063', qtyMt: 300, bl: '198GX06523', netMt: 15.296 }),
];
const ev = (subject: string, body: string, attachments: Array<{ name: string; text?: string }> = [], counterparty: string | null = null): EmailEvidence => ({ subject, body, attachments: attachments.map((a) => ({ name: a.name, text: a.text ?? '' })), date: new Date('2026-10-23T05:00:00Z'), counterparty });
const decide = (e: EmailEvidence, thread: any = null) => decideMatch({ ev: e, records: RECORDS, hits: findKeyHits(e, RECORDS), thread });
const baseInput = (over: Record<string, any>) => ({ inboxState: 'SUGGESTED', verdict: 'SHIPMENT', subject: '', attachments: [], filesSomething: false, fillsSomething: false, target: null, confidence: 'none', check: [], multiOrderIds: [], wouldAuto: false, targetClosed: false, keyInAims: false, ...over });

describe('case 1 — exact tonnages of #19-1 + #19-2 in the subject, B/L 198GX06322 in the text', () => {
  const e = ev('Re: 書類送付: 11月納入6063材ー281.919T,15.296T_アジアディールハブ', 'フリータイムは下記の通りです。198GX06322: demurrage 10 days, detention 4 days\n\n-----Original Message-----\n198GX06516, 198GX06524', [{ name: 'image.png' }], 'MITSUI_SOKO');
  it('names three records by hard key — a link-only email links to all of them (the owner expects #19-1 + #19-2; the text also names #18-1)', () => {
    const d = decide(e);
    expect(d.target).toBeNull();
    expect(d.links?.map((l) => l.shipmentId).sort()).toEqual(['s18-1', 's19-1', 's19-2']);
    expect(d.blocked).toEqual(['a: several records named (#18-1, #19-1, #19-2)']);
    expect(d.reason).toContain('net 281.919');
    const v = classifyEmail(baseInput({ subject: e.subject, attachments: [{ name: 'image.png', slot: null }], links: d.links, linksByKey: true, multiOrderIds: d.multiOrderIds }));
    expect(v.kind).toBe('MULTI_LINK');
    expect(v.reason).toBe('the email names 3 records — linked to all, nothing filed');
    expect(multiLinkLabel(v.reason)).toBe('linked (B/Ls)');
  });
  it('the same email WITH a document to file asks a person to pick', () => {
    const v = classifyEmail(baseInput({ subject: e.subject, attachments: [{ name: 'invoice.pdf', slot: 'VENDOR_INVOICE' }], filesSomething: true, links: decide(e).links, linksByKey: true }));
    expect(v.kind).toBe('PICK');
  });
});

describe('case 2 — SUS schedule sheet on an order matched by subject + thread', () => {
  it('links to the order\'s live shipments, nothing filed', () => {
    const v = classifyEmail(baseInput({
      subject: 'Re: 書類送付: 6005C材220MT 2026年11月納入分　ーアジアディールハブ',
      attachments: [{ name: 'ビレット受け入れ計画.xlsx', slot: 'DELIVERY_SCHEDULE' }],
      target: { orderId: 'o18', shipmentId: null },
      confidence: 'cues',
      sources: ['subject', 'thread'],
      orderShipments: [{ orderId: 'o18', shipmentId: 's18-1', ref: '#18-1' }, { orderId: 'o18', shipmentId: 's18-2', ref: '#18-2' }, { orderId: 'o18', shipmentId: 's18-3', ref: '#18-3' }],
    }));
    expect(v.kind).toBe('MULTI_LINK');
    expect(v.links?.map((l) => l.shipmentId)).toEqual(['s18-1', 's18-2', 's18-3']);
    expect(v.reason).toContain('delivery schedule for the order');
    expect(multiLinkLabel(v.reason)).toBe('linked (schedule)');
  });
  it('one source only, or a field to fill: still a question', () => {
    const i = { subject: 'x', attachments: [{ name: 's.xlsx', slot: 'DELIVERY_SCHEDULE' }], target: { orderId: 'o18', shipmentId: null }, orderShipments: [{ orderId: 'o18', shipmentId: 's18-1', ref: '#18-1' }, { orderId: 'o18', shipmentId: 's18-2', ref: '#18-2' }] };
    expect(classifyEmail(baseInput({ ...i, sources: ['subject'] })).kind).not.toBe('MULTI_LINK');
    expect(classifyEmail(baseInput({ ...i, sources: ['subject', 'thread'], fillsSomething: true })).kind).not.toBe('MULTI_LINK');
  });
});

describe('case 3 — three warehouse invoices, each naming its own B/L', () => {
  it('the attachments name #15-1 / #16-1 / #16-2 (the service splits them); an inline Outlook image is never a document', () => {
    const e = ev('【請求書送付】ビレット案件（10月納入6005ー120t, 6063ー300t）_アジアディールハブ', '請求書を送付します。', [{ name: 'Outlook-bwmhkrtx.png' }, { name: '請求書_IM3Z690456.pdf', text: 'B/L 198GX05383' }, { name: '請求書_IM3Z6A0049.pdf', text: 'B/L 198GX05781' }, { name: '請求書_IM3Z6A0114.pdf', text: 'B/L 198GX06003' }], 'MITSUI_SOKO');
    const d = decide(e);
    expect(d.links?.map((l) => l.shipmentId).sort()).toEqual(['s15-1', 's16-1', 's16-2']);
    expect(isInlineImage('Outlook-bwmhkrtx.png')).toBe(true);
    expect(isInlineImage('image001.png')).toBe(true);
    expect(isInlineImage('請求書_IM3Z690456.pdf')).toBe(false);
  });
});

describe('case 4 — a detention request quoting every Wan Hai B/L, nothing to file', () => {
  it('links to all quoted shipments by itself', () => {
    const e = ev('RE: Request for Extension of Detention Free Time for Japan WANHAI Shipments', 'Noted, we will revert.\n\n-----Original Message-----\nB/Ls: 198GX05383, 198GX05781, 198GX06003, 198GX06516', [], 'VEDANTA');
    const d = decide(e);
    expect(d.target).toBeNull();
    expect(d.quoted.map((q) => q.ref).sort()).toEqual(['#15-1', '#16-1', '#16-2', '#18-2']);
    const v = classifyEmail(baseInput({ subject: e.subject, quotedRecords: d.quoted, keyInAims: false }));
    expect(v.kind).toBe('MULTI_LINK');
    expect(v.links).toHaveLength(4);
    expect(multiLinkLabel(v.reason)).toBe('linked (B/Ls)');
    // With a document to file it stays a question (pick).
    expect(classifyEmail(baseInput({ subject: e.subject, quotedRecords: d.quoted, attachments: [{ name: 'a.pdf', slot: 'OTHER' }] })).kind).toBe('PICK');
  });
});

describe('case 5 — a telex whose subject names the B/L', () => {
  const e = ev('TELEX MSG - Asia Deal(Sus) //454003255 //198GX06516 // 20.416 MT//Yokohama', 'Telex code for subject BL - RINVIZ026A212\n\nBL | qty\n198GX06516 | 20.416\n198GX06524 | 17.861\n198GX06523 | 15.296', [{ name: 'image001.jpg' }], 'VEDANTA');
  it('the code is tied to the subject\'s B/L even though the table lists the sister B/Ls', () => {
    expect(telexTiedTo(e, 'RINVIZ026A212', '198GX06516')).toBe(true);
    expect(telexTiedTo(e, 'RINVIZ026A212', '198GX06524')).toBe(false);
    // No B/L in the subject and the code in a paragraph with several B/Ls: not tied (unchanged).
    expect(telexTiedTo(ev('TELEX', 'code RINVIZ026A212\n\nBLs:\n198GX06516\n198GX06524', []), 'RINVIZ026A212', '198GX06516')).toBe(false);
  });
  it('the second pass naming #18-2 + #18-3 + #19-2 + #19-1 does not doubt a link the subject\'s B/L supports', () => {
    const hits = findKeyHits(e, RECORDS);
    const second: any = { apply: true, isShipmentMail: true, evidence: 'the table', reason: 'all four', keyLabel: null, targets: [{ orderId: 'o18', shipmentId: 's18-2', attachmentIndexes: [], docTypes: {} }, { orderId: 'o18', shipmentId: 's18-3', attachmentIndexes: [], docTypes: {} }, { orderId: 'o19', shipmentId: 's19-2', attachmentIndexes: [], docTypes: {} }], picks: [] };
    const r = auditLink({ current: [{ orderId: 'o18', shipmentId: 's18-2' }], general: false, hits, orderCues: [], second, records: RECORDS });
    expect(r.verdict).toBe('AGREE');
    expect(r.secondText).toContain('includes the linked #18-2');
    // A second pass naming OTHER records only is still a disagreement.
    const other = { ...second, targets: [{ orderId: 'o19', shipmentId: 's19-1', attachmentIndexes: [], docTypes: {} }] };
    expect(auditLink({ current: [{ orderId: 'o18', shipmentId: 's18-2' }], general: false, hits, orderCues: [], second: other, records: RECORDS }).verdict).toMatch(/DISAGREE/);
  });
});

describe('summaries — the owner\'s length limit, never a cut', () => {
  it('EN over 20 words / JA a clause over 40 characters is "too long"', () => {
    expect(summaryTooLong('Vedanta sends the telex release code.', 'en')).toBe(false);
    expect(summaryTooLong('Mitsui Soko confirms receipt of the documents and states the free time for the four September B/Ls and asks ADH to keep requesting continued free-time extensions from the line.', 'en')).toBe(true);
    expect(summaryTooLong('三井倉庫が書類の受領を確認し、フリータイムを案内しています。', 'ja')).toBe(false);
    expect(summaryTooLong('三井倉庫が書類の受領を確認し四本の九月末船積みB/Lについてデマレージ十日とディテンション四日のフリータイムを案内した上で引き続き延長申請を依頼しています', 'ja')).toBe(true);
  });
});
