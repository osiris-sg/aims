import { placementTargets } from './email-triage.service';
import { answerText, questionOf, QuestionInput } from './email-question';
import { parseGeneralIssue, parseReasonerOutput } from './email-reasoner';

const input = (o: Partial<QuestionInput>): QuestionInput => ({
  lang: 'en',
  reasonCode: 'PICK_SHIPMENT',
  subject: 'RE: Request for the development of Packing list for one budle having different batch',
  company: 'Vedanta',
  attachments: ['COA 265C1186 SUS 26th Oct.pdf'],
  threadSize: 3,
  suggested: null,
  candidates: [],
  check: [],
  summaryOf: (_o, s) => (s ? `#${s}` : null),
  ...o,
});

describe('round AR — several shipments, general issues', () => {
  it('placementTargets: every chosen record linked, each file to its own targets, a file on two = linked to both', () => {
    const t = placementTargets(
      [{ orderId: 'o16', shipmentId: 's16' }, { orderId: 'o18', shipmentId: 's18' }],
      [
        { emailId: 'e', index: 0, targets: [{ orderId: 'o16', shipmentId: 's16' }] },
        { emailId: 'e', index: 1, targets: [{ orderId: 'o16', shipmentId: 's16' }, { orderId: 'o20', shipmentId: 's20' }] },
        { emailId: 'e', index: 2, targets: [] },
      ],
    );
    expect(t).toEqual([
      { orderId: 'o16', shipmentId: 's16', attachmentIndexes: [0, 1] },
      { orderId: 'o18', shipmentId: 's18', attachmentIndexes: [] },
      { orderId: 'o20', shipmentId: 's20', attachmentIndexes: [1] },
    ]);
  });

  it('a card with several exact shipments proposes all of them (ticked)', () => {
    const q = questionOf(input({ multi: [{ orderId: 'o16', shipmentId: 's16', ref: '#16-1', why: ['bundle 265C118614 on its packing list / COA'] }, { orderId: 'o21', shipmentId: 's21', ref: '#21-1', why: ['B/L 198GX06523'] }] }));
    expect(q.multi).toBe(true);
    expect(q.options.filter((o) => o.suggested).map((o) => o.ref)).toEqual(['#16-1', '#21-1']);
    expect(q.title).toBe('This email is about 2 shipments (#16-1, #21-1). Link it to all of them?');
  });

  it('one exact shipment is not "multi"', () => {
    const q = questionOf(input({ multi: [], suggested: { orderId: 'o16', shipmentId: 's16', ref: '#16-1', why: [] } }));
    expect(q.multi).toBeUndefined();
  });

  it('a policy change is proposed as a general issue', () => {
    const issue = { title: 'Mixed-batch bundles: manual COA + ADH material code from Sep supplies', summaryEn: 'x', summaryJa: 'y', effectiveFrom: 'September 2026 supplies' };
    const q = questionOf(input({ issue }));
    expect(q.issue).toEqual(issue);
    expect(q.title).toMatch(/general issue, not one shipment/);
    expect(questionOf(input({ issue, lang: 'ja' })).title).toMatch(/全般的な課題/);
  });

  it('answer text for a general issue (with and without shipments)', () => {
    expect(answerText('general', 'en', { issue: 'Mixed-batch bundles' })).toBe('Issue added: Mixed-batch bundles');
    expect(answerText('record', 'en', { refs: ['#16-1'], files: 2, issue: 'Mixed-batch bundles' })).toBe('Issue added: Mixed-batch bundles · Linked to #16-1 · 2 files filed');
    expect(answerText('general', 'ja', { issue: '混在バンドル' })).toBe('課題「混在バンドル」を追加');
  });

  it('the reasoner\'s generalIssue is parsed strictly', () => {
    expect(parseGeneralIssue({ title: '  ' })).toBeNull();
    expect(parseGeneralIssue({ title: 'New process', summaryEn: 'a', effectiveFrom: 7 })).toEqual({ title: 'New process', summaryEn: 'a', summaryJa: null, effectiveFrom: null });
    const out = parseReasonerOutput({ isShipmentMail: true, reason: 'r', decisions: [], generalIssue: { title: 'T', summaryJa: 'J' } }, [], 0);
    expect(out?.generalIssue).toEqual({ title: 'T', summaryEn: null, summaryJa: 'J', effectiveFrom: null });
    expect(parseReasonerOutput({ isShipmentMail: true, reason: 'r', decisions: [] }, [], 0)?.generalIssue).toBeNull();
  });
});
