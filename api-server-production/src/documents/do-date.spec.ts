// UAT 2026-11-25 (DO202611050): a DO made by "Add DO" had no date: blank on the print / sign page / order page,
// the UTC day (24/11) on the list. WCT group only (DO_DATE_FLAG); every other org unchanged.
import { DO_DATE_FLAG, doDateOrCreated, ownDocDate, withDoDate } from './do-date';
import { DocumentsService, documentIssueDate } from './documents.service';
import { renderWctBody } from '../common/services/document-html/wct';
import { resolveDesign } from '../common/services/document-html/design';

// 04:20 SGT on 25 Nov = 20:20 UTC on 24 Nov.
const CREATED = new Date('2026-11-24T20:20:45.474Z');

describe('do-date helpers', () => {
  it('withDoDate fills a missing date and never overwrites one', () => {
    expect(withDoDate({ items: [] }, '2026-11-25')).toEqual({ items: [], date: '2026-11-25' });
    expect(withDoDate({ date: '2026-11-28' }, '2026-11-25')).toEqual({ date: '2026-11-28' });
    expect(withDoDate({ documentInfo: { date: '2026-11-20' } }, '2026-11-25')).toEqual({ documentInfo: { date: '2026-11-20' } });
    expect(ownDocDate({ date: '  ' })).toBe('');
  });
  it('doDateOrCreated: own date first, else the created day in the org time zone (not UTC)', () => {
    expect(doDateOrCreated({ date: '2026-11-28' }, CREATED, 'Asia/Singapore')).toBe('2026-11-28');
    expect(doDateOrCreated({}, CREATED, 'Asia/Singapore')).toBe('2026-11-25');
    expect(doDateOrCreated({}, CREATED, null)).toBe('2026-11-25'); // default zone = Singapore
    expect(doDateOrCreated({}, null, 'Asia/Singapore')).toBeNull();
  });
  it('documentIssueDate: the org-zone day when a zone is given (WCT list), the UTC day as before without one', () => {
    expect(documentIssueDate({}, CREATED, 'Asia/Singapore')).toBe('2026-11-25');
    expect(documentIssueDate({}, CREATED)).toBe('2026-11-24');
    expect(documentIssueDate({ date: '2026-11-28' }, CREATED, 'Asia/Singapore')).toBe('2026-11-28');
  });
});

describe('WCT DO print: never a blank Date', () => {
  const design = resolveDesign({ layout: 'wct' } as any);
  const dateOf = (html: string) => /<span>Date<\/span><span>([^<]*)<\/span>/.exec(html)?.[1];
  const base = { name: 'DO202611050', customer: { name: 'TEST Client' }, items: [{ description: 'Hood', quantity: 1 }] };
  it('no date: the created day in Singapore', () => {
    expect(dateOf(renderWctBody('do', { ...base, documentInfo: {}, createdAt: CREATED } as any, {}, design))).toBe('25/11/2026');
  });
  it('its own date wins', () => {
    expect(dateOf(renderWctBody('do', { ...base, documentInfo: { date: '2026-11-28' }, createdAt: CREATED } as any, {}, design))).toBe('28/11/2026');
  });
});

describe('createNumberedDeliveryOrder: a new WCT DO is dated today (org time zone)', () => {
  const make = (features: any) => {
    const created: any[] = [];
    const svc: any = Object.create(DocumentsService.prototype);
    svc.prisma = {
      organizationUIConfig: { findUnique: async () => ({ features }) },
      accountingSetting: { findUnique: async () => ({ timeZone: 'Asia/Singapore' }) },
      document: { count: async () => 0 },
    };
    svc.documentNumbering = { issueNumberLocked: async () => 'DO202611050' };
    svc.createBasicDocument = async (_t: string, _type: string, _org: string, config: any, _p: any, _u: any, name: string) => {
      created.push(config);
      return { id: 'd1', name };
    };
    return { svc, created };
  };
  it('WCT group (flag on): config.date = today', async () => {
    const { svc, created } = make({ [DO_DATE_FLAG]: true });
    await svc.createNumberedDeliveryOrder('t', 'o', { items: [], doFirst: true });
    expect(created[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('a date already given (a scheduled job) is kept', async () => {
    const { svc, created } = make({ [DO_DATE_FLAG]: true });
    await svc.createNumberedDeliveryOrder('t', 'o', { items: [], date: '2026-12-01' });
    expect(created[0].date).toBe('2026-12-01');
  });
  it('every other org (flag off): unchanged, no date added', async () => {
    const { svc, created } = make({});
    await svc.createNumberedDeliveryOrder('t', 'o', { items: [] });
    expect(created[0].date).toBeUndefined();
  });
});
