import { blockingSteps, decodeUploadName, hasExactlyOneOwner, missingDocTypes, parseIdList, progressOf, resolveTradeFileMime, sanitizeFileName, stepRequirements, stepsBrokenByRemoval } from './shipments.rules';

const step = (over: Partial<{ id: string; title: string; status: string; isOngoing: boolean; requiredDocTypes: string[] }> = {}) => ({
  id: over.id ?? 's1',
  title: over.title ?? 'Step',
  status: over.status ?? 'NOT_STARTED',
  isOngoing: over.isOngoing ?? false,
  requiredDocTypes: over.requiredDocTypes ?? [],
});

describe('missingDocTypes', () => {
  it('lists required codes with no linked file', () => {
    expect(missingDocTypes(['BL', 'CI', 'PL'], ['CI'])).toEqual(['BL', 'PL']);
  });
  it('is empty when nothing is required', () => {
    expect(missingDocTypes([], [])).toEqual([]);
  });
  it('dedupes required codes', () => {
    expect(missingDocTypes(['BL', 'BL'], [])).toEqual(['BL']);
  });
});

describe('blockingSteps (complete contract/shipment)', () => {
  it('blocks on everything but DONE (skipping was removed, so a legacy SKIPPED row blocks too)', () => {
    const steps = [step({ id: 'a', status: 'DONE' }), step({ id: 'b', status: 'SKIPPED' }), step({ id: 'c', status: 'IN_PROGRESS' }), step({ id: 'd', status: 'NOT_STARTED' })];
    expect(blockingSteps(steps).map((s) => s.id)).toEqual(['b', 'c', 'd']);
  });
  it('never blocks on an ongoing step', () => {
    expect(blockingSteps([step({ status: 'NOT_STARTED', isOngoing: true })])).toEqual([]);
  });
});

describe('stepsBrokenByRemoval (unlink / delete file)', () => {
  const done = step({ id: 'bl', title: 'B/L draft approval', status: 'DONE', requiredDocTypes: ['BL_DRAFT'] });
  it('flags a DONE step that would lose its only required file', () => {
    const r = stepsBrokenByRemoval([done], []);
    expect(r).toHaveLength(1);
    expect(r[0].step.id).toBe('bl');
    expect(r[0].missing).toEqual(['BL_DRAFT']);
  });
  it('allows removal when another file of that type is still linked', () => {
    expect(stepsBrokenByRemoval([done], ['BL_DRAFT'])).toEqual([]);
  });
  it('ignores steps that are not DONE', () => {
    const open = step({ status: 'IN_PROGRESS', requiredDocTypes: ['BL_DRAFT'] });
    const skipped = step({ status: 'SKIPPED', requiredDocTypes: ['BL_DRAFT'] });
    expect(stepsBrokenByRemoval([open, skipped], [])).toEqual([]);
  });
});

describe('progressOf', () => {
  it('counts only DONE and excludes ongoing steps', () => {
    expect(
      progressOf([
        { status: 'DONE', isOngoing: false },
        { status: 'SKIPPED', isOngoing: false },
        { status: 'NOT_STARTED', isOngoing: false },
        { status: 'NOT_STARTED', isOngoing: true },
      ]),
    ).toEqual({ done: 1, total: 3 });
  });
});

describe('stepRequirements', () => {
  it('counts files and live documents per required type', () => {
    expect(stepRequirements(['INVOICE_1', 'PI', 'PI'], ['PI', 'PI'], ['INVOICE_1'])).toEqual([
      { docType: 'INVOICE_1', files: 0, documents: 1, satisfied: true },
      { docType: 'PI', files: 2, documents: 0, satisfied: true },
    ]);
  });
  it('is unsatisfied with neither', () => {
    expect(stepRequirements(['INVOICE_2'], ['PI'], [])).toEqual([{ docType: 'INVOICE_2', files: 0, documents: 0, satisfied: false }]);
  });
});

describe('hasExactlyOneOwner', () => {
  it('requires exactly one of contractId / shipmentId', () => {
    expect(hasExactlyOneOwner({ contractId: 'c' })).toBe(true);
    expect(hasExactlyOneOwner({ shipmentId: 's' })).toBe(true);
    expect(hasExactlyOneOwner({ contractId: 'c', shipmentId: 's' })).toBe(false);
    expect(hasExactlyOneOwner({})).toBe(false);
  });
});

describe('resolveTradeFileMime', () => {
  it('accepts listed types', () => {
    expect(resolveTradeFileMime('bl.pdf', 'application/pdf')).toBe('application/pdf');
    expect(resolveTradeFileMime('scan.JPG', 'image/jpeg')).toBe('image/jpeg');
  });
  it("accepts Vedanta's tab-delimited .XLS sent as text/plain, stored as Excel", () => {
    expect(resolveTradeFileMime('PACKING LIST.XLS', 'text/plain')).toBe('application/vnd.ms-excel');
  });
  it('accepts Outlook .msg sent as octet-stream', () => {
    expect(resolveTradeFileMime('mail.msg', 'application/octet-stream')).toBe('application/vnd.ms-outlook');
  });
  it('rejects unlisted types and generic types without a listed extension', () => {
    expect(resolveTradeFileMime('tool.exe', 'application/octet-stream')).toBeNull();
    expect(resolveTradeFileMime('notes.txt', 'text/plain')).toBeNull();
    expect(resolveTradeFileMime('clip.mp4', 'video/mp4')).toBeNull();
  });
});

describe('file name helpers', () => {
  it('sanitizes for S3 and keeps the extension when truncating', () => {
    expect(sanitizeFileName('B/L draft (v2).pdf')).toBe('B_L_draft_v2_.pdf');
    const long = sanitizeFileName('a'.repeat(150) + '.pdf');
    expect(long.length).toBe(100);
    expect(long.endsWith('.pdf')).toBe(true);
  });
  it('re-decodes UTF-8 names that multer read as latin1', () => {
    const garbled = Buffer.from('船荷証券.pdf', 'utf8').toString('latin1');
    expect(decodeUploadName(garbled)).toBe('船荷証券.pdf');
    expect(decodeUploadName('plain.pdf')).toBe('plain.pdf');
  });
  it('parses id lists from arrays, JSON and comma strings', () => {
    expect(parseIdList(['a', 'b', 'a'])).toEqual(['a', 'b']);
    expect(parseIdList('["a","b"]')).toEqual(['a', 'b']);
    expect(parseIdList('a, b')).toEqual(['a', 'b']);
    expect(parseIdList(undefined)).toEqual([]);
  });
});
