import { cleanPacking, cleanProduct, ClientProduct, parseSize, productLabel, productMatch, productSize } from './clients-products';
import { maskedProfile } from './clients-company';
import { mergeProfiles } from './trade-profile';

const bad = (m: string): never => {
  throw new Error(m);
};
const NOW = '2026-11-02T00:00:00.000Z';
const ID = '11111111-1111-4111-8111-111111111111';

describe('round BA: client products', () => {
  it('parses sizes and builds labels', () => {
    expect(parseSize('152 × 5800')).toEqual({ diameterMm: 152, lengthMm: 5800 });
    expect(parseSize('203 MM X 5800 MM')).toEqual({ diameterMm: 203, lengthMm: 5800 });
    expect(parseSize('ingot')).toBeNull();
    const p = cleanProduct({ grade: '6063', form: 'BILLET', sizeText: '152x5800' }, undefined, ID, NOW, bad);
    expect(productSize(p)).toBe('152 × 5800');
    expect(productLabel(p)).toBe('6063 billet 152 × 5800');
  });

  it('cleans a product: chemistry limits, numbers, server-owned fields', () => {
    const p = cleanProduct(
      { grade: ' 6063 ', form: 'BILLET', diameterMm: '152', lengthMm: 5800, chemistry: [{ element: 'Si', min: 0.2, max: 0.6 }, { element: 'Fe', max: '0.35' }, { element: '', max: 1 }, { element: 'Mg' }], piecesPerBundle: 5, bundleWeightKg: '1,180', specFiles: [{ s3Key: 'x' }], id: 'forged' },
      undefined, ID, NOW, bad,
    );
    expect(p).toMatchObject({ id: ID, grade: '6063', diameterMm: 152, lengthMm: 5800, piecesPerBundle: 5, bundleWeightKg: 1180, specFiles: [], hidden: false, createdAt: NOW });
    expect(p.chemistry).toEqual([{ element: 'Si', min: 0.2, max: 0.6 }, { element: 'Fe', min: null, max: 0.35 }]);
    expect(() => cleanProduct({ grade: '6063', form: 'BAR' }, undefined, ID, NOW, bad)).toThrow(/Unknown form/);
    expect(() => cleanProduct({ grade: '6063', chemistry: [{ element: 'si', max: 1 }] }, undefined, ID, NOW, bad)).toThrow(/element symbol/);
    expect(() => cleanProduct({ grade: '6063', chemistry: [{ element: 'Si', min: 0.9, max: 0.2 }] }, undefined, ID, NOW, bad)).toThrow(/min is above max/);
    expect(() => cleanProduct({}, undefined, ID, NOW, bad)).toThrow(/at least/);
  });

  it('an edit keeps files, source and creation; a changed field leaves "to confirm"', () => {
    const prev: ClientProduct = { id: ID, grade: '6063', form: 'BILLET', piecesPerBundle: null, specFiles: [{ id: 'f', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1, s3Key: 'k', uploadedAt: NOW }], source: 'order #21', toConfirm: ['piecesPerBundle', 'standard'], createdAt: '2026-10-01T00:00:00.000Z' };
    const p = cleanProduct({ grade: '6063', form: 'BILLET', piecesPerBundle: 5 }, prev, ID, NOW, bad);
    expect(p.specFiles).toHaveLength(1);
    expect(p.source).toBe('order #21');
    expect(p.createdAt).toBe('2026-10-01T00:00:00.000Z');
    expect(p.toConfirm).toEqual(['standard']);
  });

  it('matches supplier products on grade + form; size decides exact vs grade', () => {
    const want = cleanProduct({ grade: '6063', form: 'BILLET', sizeText: '152 × 5800' }, undefined, ID, NOW, bad);
    const same = cleanProduct({ grade: '6063', form: 'BILLET', sizeText: '152x5800' }, undefined, ID, NOW, bad);
    const other = cleanProduct({ grade: '6063', form: 'BILLET', sizeText: '203 × 5800' }, undefined, ID, NOW, bad);
    const ingot = cleanProduct({ grade: 'P1020', form: 'INGOT' }, undefined, ID, NOW, bad);
    expect(productMatch(want, same)).toBe('exact');
    expect(productMatch(want, other)).toBe('grade');
    expect(productMatch(want, ingot)).toBeNull();
    expect(productMatch(want, { ...same, hidden: true })).toBeNull();
  });

  it('packing: notes, issue ids; images only through upload', () => {
    const issue = '22222222-2222-4222-8222-222222222222';
    expect(cleanPacking({ notes: ' geta ingots ', issueIds: [issue, issue], images: [{ s3Key: 'x' }] }, { images: [] }, bad)).toEqual({ notes: 'geta ingots', images: [], issueIds: [issue] });
    expect(() => cleanPacking({ issueIds: ['nope'] }, undefined, bad)).toThrow(/issue ids/);
  });

  it('a settings save keeps products / packing; the screens never get S3 keys from the profile', () => {
    const cid = '33333333-3333-4333-8333-333333333333';
    const stored = { [cid]: { customerId: cid, billingMode: 'TWO_STAGE', sendImportPermit: true, truckCapacityT: 10, docVariants: {}, products: [{ id: ID, grade: '6063' }], packing: { notes: 'n' } } };
    const saved = mergeProfiles(stored, { [cid]: { billingMode: 'TWO_STAGE', truckCapacityT: 10, docVariants: {}, products: [] } }, bad);
    expect(saved[cid].products).toEqual([{ id: ID, grade: '6063' }]);
    expect(saved[cid].packing).toEqual({ notes: 'n' });
    const masked: any = maskedProfile(saved[cid]);
    expect(masked.products).toBeUndefined();
    expect(masked.packing).toBeUndefined();
  });
});
