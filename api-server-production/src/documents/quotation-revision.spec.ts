import { nextRevision, revisionOfName, stripRevisionSuffix } from './quotation-revision';

describe('quotation revision numbers (-R1, -R2)', () => {
  it('the first revision of an original is -R1', () => {
    expect(nextRevision('QO202611-0016', 0)).toEqual({ name: 'QO202611-0016-R1', revisionNumber: 1 });
    expect(nextRevision('QO202611-0016', null)).toEqual({ name: 'QO202611-0016-R1', revisionNumber: 1 });
  });
  it('a revision moves to the next one, never -R1-R2', () => {
    expect(nextRevision('QO202611-0016-R1', 1)).toEqual({ name: 'QO202611-0016-R2', revisionNumber: 2 });
    expect(nextRevision('QO202611-0016-R9', 9).name).toBe('QO202611-0016-R10');
  });
  it('the higher of the number and the stored count wins', () => {
    expect(nextRevision('QO202611-0016-R3', 1).name).toBe('QO202611-0016-R4');
    expect(nextRevision('QO202611-0016', 2).name).toBe('QO202611-0016-R3');
  });
  it('reads and strips the suffix only at the end', () => {
    expect(revisionOfName('QO202611-0016')).toBe(0);
    expect(revisionOfName('QO202611-0016-R2')).toBe(2);
    expect(stripRevisionSuffix('QO-R1-202611-0016')).toBe('QO-R1-202611-0016');
    expect(stripRevisionSuffix('QO202611-0016-R2')).toBe('QO202611-0016');
  });
});
