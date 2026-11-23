import { normalizeScheduleSource, scheduleSourceMissing, SCHEDULE_SOURCE_REQUIRED } from './schedule-source';

describe('normalizeScheduleSource', () => {
  it('keeps a quotation with its document and number', () => {
    expect(normalizeScheduleSource({ kind: 'QUOTATION', documentId: 'doc-1', number: 'QO202607-0025' })).toEqual({
      kind: 'QUOTATION',
      documentId: 'doc-1',
      number: 'QO202607-0025',
    });
  });

  it('keeps a master contract with its uploaded file', () => {
    expect(
      normalizeScheduleSource({ kind: 'CONTRACT', fileName: 'contract.pdf', fileUrl: 'https://s3/x.pdf' }),
    ).toEqual({ kind: 'CONTRACT', fileName: 'contract.pdf', fileUrl: 'https://s3/x.pdf' });
  });

  it('accepts a lowercase kind', () => {
    expect(normalizeScheduleSource({ kind: 'sales_order', documentId: 'd' })?.kind).toBe('SALES_ORDER');
  });

  // A hollow marker is worse than none: it would satisfy the gate below while
  // telling the office nothing about what the run was scheduled on.
  it('rejects a document-backed source with no document', () => {
    expect(normalizeScheduleSource({ kind: 'QUOTATION', number: 'QO-1' })).toBeNull();
    expect(normalizeScheduleSource({ kind: 'SALES_ORDER', documentId: '   ' })).toBeNull();
  });

  it('rejects a contract with no file', () => {
    expect(normalizeScheduleSource({ kind: 'CONTRACT', fileName: 'contract.pdf' })).toBeNull();
  });

  it('rejects an unknown or missing kind, and non-objects', () => {
    expect(normalizeScheduleSource({ kind: 'PURCHASE_ORDER', documentId: 'd' })).toBeNull();
    expect(normalizeScheduleSource({ documentId: 'd' })).toBeNull();
    expect(normalizeScheduleSource(null)).toBeNull();
    expect(normalizeScheduleSource('QUOTATION')).toBeNull();
  });
});

describe('scheduleSourceMissing', () => {
  const source = { kind: 'QUOTATION' as const, documentId: 'doc-1' };

  it('refuses a real schedule with nothing behind it on a wizard org', () => {
    expect(scheduleSourceMissing({ isDraft: false, wizardOrg: true, source: null })).toBe(true);
  });

  it('allows it once a source is sent', () => {
    expect(scheduleSourceMissing({ isDraft: false, wizardOrg: true, source })).toBe(false);
  });

  // The whole point of leaving drafts out: a job regularly arrives before its
  // paperwork, and the office must still be able to park what they typed.
  it('never blocks a draft', () => {
    expect(scheduleSourceMissing({ isDraft: true, wizardOrg: true, source: null })).toBe(false);
  });

  it('never blocks an org without the flag', () => {
    expect(scheduleSourceMissing({ isDraft: false, wizardOrg: false, source: null })).toBe(false);
  });

  // An edit that only moves the date does not re-send the paperwork step.
  it('accepts the source already stored on the run', () => {
    expect(
      scheduleSourceMissing({ isDraft: false, wizardOrg: true, source: null, existing: { kind: 'CONTRACT', fileUrl: 'https://s3/x.pdf' } }),
    ).toBe(false);
  });

  it('still refuses when the stored source is junk', () => {
    expect(scheduleSourceMissing({ isDraft: false, wizardOrg: true, source: null, existing: { kind: 'NOPE' } })).toBe(true);
  });
});

it('names all three ways out in the message', () => {
  expect(SCHEDULE_SOURCE_REQUIRED).toMatch(/quotation/i);
  expect(SCHEDULE_SOURCE_REQUIRED).toMatch(/Sales Order/i);
  expect(SCHEDULE_SOURCE_REQUIRED).toMatch(/master contract/i);
  expect(SCHEDULE_SOURCE_REQUIRED).toMatch(/draft/i);
});
