import { distinctiveName, mapLimit, markVersions, newerVersionOf, versionKey } from './email-file-versions';

describe('round BF — file versions', () => {
  it('same name ignores case, spaces and a " (n)" copy mark', () => {
    expect(versionKey('198GX07112 BLCopyView (1).pdf')).toBe(versionKey('198gx07112  BLCopyView.PDF'));
    expect(versionKey('198GX07112 BLCopyView (2).pdf')).toBe(versionKey('198GX07112 BLCopyView.pdf'));
    expect(versionKey('COA.pdf')).not.toBe(versionKey('COA.xlsx'));
  });

  it('three same-name files: newest = Latest, the others Older version, identical bytes named', () => {
    const m = markVersions([
      { id: 'a', name: '198GX07112 BLCopyView (1).pdf', date: '2026-11-03T05:00:00Z', sha256: 'h1' },
      { id: 'b', name: '198GX07112 BLCopyView (1).pdf', date: '2026-11-05T05:02:00Z', sha256: 'h2' },
      { id: 'c', name: '198GX07112 BLCopyView (1).pdf', date: '2026-11-04T01:00:00Z', sha256: 'h2' },
      { id: 'd', name: 'Invoice.pdf', date: '2026-11-04T01:00:00Z', sha256: 'h9' },
    ]);
    expect(m.get('b')).toEqual({ versions: 3, latest: true, olderAt: null, identicalTo: null });
    expect(m.get('c')).toEqual({ versions: 3, latest: false, olderAt: '2026-11-04T01:00:00.000Z', identicalTo: 'b' });
    expect(m.get('a')).toMatchObject({ latest: false, identicalTo: null });
    expect(m.get('d')).toMatchObject({ versions: 1, latest: true });
  });

  it('different names with the same bytes are versions too', () => {
    const m = markVersions([
      { id: 'x', name: 'PL.pdf', date: '2026-11-01T00:00:00Z', sha256: 's' },
      { id: 'y', name: 'Packing list rev.pdf', date: '2026-11-02T00:00:00Z', sha256: 's' },
    ]);
    expect(m.get('y')).toMatchObject({ versions: 2, latest: true });
    expect(m.get('x')).toMatchObject({ latest: false, identicalTo: 'y' });
  });

  it('a newer version = same name, received later, other bytes', () => {
    const linked = { name: '198GX07112 BLCopyView (1).pdf', date: '2026-11-03T05:00:00Z', sha256: 'h1' };
    const c = (emailId: string, date: string, sha256: string | null, name = linked.name) => ({ emailId, index: 0, name, date, sha256 });
    expect(newerVersionOf(linked, [c('old', '2026-11-02T00:00:00Z', 'h0'), c('same', '2026-11-04T00:00:00Z', 'h1')])).toBeNull();
    expect(newerVersionOf(linked, [c('n1', '2026-11-04T00:00:00Z', null), c('n2', '2026-11-05T05:02:00Z', 'h3')])?.emailId).toBe('n2');
    expect(newerVersionOf(linked, [c('other', '2026-11-05T00:00:00Z', 'h3', 'COA.pdf')])).toBeNull();
  });

  it('only names with a B/L / contract-like token are searched across all emails', () => {
    expect(distinctiveName('198GX07112 BLCopyView (1).pdf')).toBe(true);
    expect(distinctiveName('454003422-1-PL.pdf')).toBe(true);
    expect(distinctiveName('Invoice.pdf')).toBe(false);
    expect(distinctiveName('BLCopyView.pdf')).toBe(false);
  });

  it('mapLimit keeps order', async () => {
    expect(await mapLimit([3, 1, 2], 2, async (x) => x * 2)).toEqual([6, 2, 4]);
  });
});
