import { categoryDefOf, categoryShown, cleanCategoryOptions, jobCategoryDef, parseCategory } from './job-category';
import { jobFieldDefs } from './job-fields';

/** Job category (WCT group): the list, blank = the default, the per-org gate, kept out of the generic job fields. */
const ORG = 'org-1';
const def = { id: 'f1', options: ['Service order', 'Delivery', 'Site visit', 'Others'], defaultValue: 'Service order' };

describe('job category: helpers', () => {
  it('cleans the list: trims, drops blanks and repeats, keeps the order; refuses an empty list', () => {
    expect(cleanCategoryOptions([' Service order ', '', 'Delivery', 'delivery', { label: 'Site visit' }])).toEqual(['Service order', 'Delivery', 'Site visit']);
    expect(() => cleanCategoryOptions([])).toThrow(/at least one/);
    expect(() => cleanCategoryOptions('x')).toThrow(/list/);
    expect(() => cleanCategoryOptions(['x'.repeat(61)])).toThrow(/60/);
  });
  it('the row as a definition: the default is defaultValue when on the list, else the first', () => {
    expect(categoryDefOf({ id: 'f1', options: [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }], defaultValue: 'B' })).toEqual({ id: 'f1', options: ['A', 'B'], defaultValue: 'B' });
    expect(categoryDefOf({ id: 'f1', options: ['A', 'B'], defaultValue: 'Z' })?.defaultValue).toBe('A');
    expect(categoryDefOf({ id: 'f1', options: [] })).toBeNull();
    expect(categoryDefOf(null)).toBeNull();
  });
  it('blank reads as "Service order"; a pick must be on the list (any case)', () => {
    expect(categoryShown(def, null)).toBe('Service order');
    expect(categoryShown(def, 'Delivery')).toBe('Delivery');
    expect(parseCategory(def, undefined)).toBe('Service order');
    expect(parseCategory(def, 'site visit')).toBe('Site visit');
    expect(() => parseCategory(def, 'Painting')).toThrow(/must be one of/);
  });
});

describe('job category: per-org gate', () => {
  const prisma = (features: any, row: any) => ({
    organizationUIConfig: { findUnique: async () => ({ features }) },
    customField: { findFirst: jest.fn(async () => row), findMany: jest.fn(async () => []) },
  });
  it('enableJobFields off: null, the field is not even read', async () => {
    const p = prisma({}, { id: 'f1', options: ['A'] });
    expect(await jobCategoryDef(p, ORG)).toBeNull();
    expect(p.customField.findFirst).not.toHaveBeenCalled();
  });
  it('no job_category field (every non-WCT org): null', async () => {
    expect(await jobCategoryDef(prisma({ enableJobFields: true }, null), ORG)).toBeNull();
  });
  it('seeded: the list', async () => {
    const p = prisma({ enableJobFields: true }, { id: 'f1', options: [{ value: 'Service order', label: 'Service order' }], defaultValue: 'Service order' });
    expect(await jobCategoryDef(p, ORG)).toEqual({ id: 'f1', options: ['Service order'], defaultValue: 'Service order' });
    expect(p.customField.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG, fieldName: 'job_category', isActive: true }) }));
  });
  it('the generic job fields list leaves job_category out (editor, badges and legend unchanged)', async () => {
    const p = prisma({ enableJobFields: true }, null);
    await jobFieldDefs(p, ORG);
    expect(p.customField.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ fieldName: { not: 'job_category' } }) }));
  });
});
