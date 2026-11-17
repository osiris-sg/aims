import { normalizeUenInput } from './customer-uen';

describe('normalizeUenInput (customer UEN on save)', () => {
  it('trims and upper-cases the UEN', () => {
    expect(normalizeUenInput({ name: 'A', uen: '  201302496e ' })).toEqual({ name: 'A', uen: '201302496E' });
  });
  it('blank becomes null', () => {
    expect(normalizeUenInput({ uen: '   ' })).toEqual({ uen: null });
    expect(normalizeUenInput({ uen: null })).toEqual({ uen: null });
  });
  it('a payload without uen (other orgs) is returned as is, no key added', () => {
    const body: { name: string; gstRegNo: string; uen?: string | null } = { name: 'Biofuel customer', gstRegNo: 'm90312345a' };
    const out = normalizeUenInput(body);
    expect(out).toBe(body);
    expect('uen' in out).toBe(false);
  });
});
