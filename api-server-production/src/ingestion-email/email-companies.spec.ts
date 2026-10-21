/**
 * Company chip (round W, C.4): the real company name from the sender domain, the org's own list first,
 * the domain itself when unknown — never "OTHER". Dummy addresses only.
 */
import { cleanCompanyOverrides, companyOf, companyOverridesOf, DEFAULT_COMPANIES } from './email-companies';

const fail = (m: string): never => {
  throw new Error(m);
};

describe('companyOf', () => {
  it('a known domain → its company (built-ins)', () => {
    expect(companyOf('ops@isewan.co.jp')).toEqual({ name: 'Isewan', domain: 'isewan.co.jp', known: true });
    expect(companyOf('a@vedanta.co.in').name).toBe('Vedanta');
    expect(companyOf('a@sus.co.jp').name).toBe('SUS');
    expect(companyOf('a@katokei.co.jp').name).toBe('Kato');
    expect(companyOf('a@mitsui-soko.co.jp').name).toBe('Mitsui Soko');
    expect(companyOf('a@wanhai.com').name).toBe('Wan Hai');
    expect(companyOf('a@asiadealhub.com').name).toBe('Asia Deal Hub');
  });
  it('a "Name <addr>" header: the address decides, the display name is ignored (untrusted)', () => {
    expect(companyOf('Vedanta Sales <someone@gmail.com>')).toEqual({ name: 'gmail.com', domain: 'gmail.com', known: false });
    expect(companyOf('Y S Agency <noreply@WanHai.com>').name).toBe('Wan Hai');
  });
  it('a subdomain matches its parent (mail.sus.co.jp → SUS; jp.mitsui-soko.co.jp → Mitsui Soko)', () => {
    expect(companyOf('x@mail.sus.co.jp')).toEqual({ name: 'SUS', domain: 'mail.sus.co.jp', known: true });
    expect(companyOf('x@jp.mitsui-soko.co.jp').name).toBe('Mitsui Soko');
  });
  it("the org's list wins over the built-ins, and names domains the built-ins don't know", () => {
    const overrides = { 'katokei.co.jp': 'Kato Light Metal', 'hoei.example.jp': 'Hoei' };
    expect(companyOf('a@katokei.co.jp', overrides)).toEqual({ name: 'Kato Light Metal', domain: 'katokei.co.jp', known: true });
    expect(companyOf('a@sales.hoei.example.jp', overrides)).toEqual({ name: 'Hoei', domain: 'sales.hoei.example.jp', known: true });
    // The built-ins still apply for domains the list leaves out.
    expect(companyOf('a@isewan.co.jp', overrides).name).toBe('Isewan');
  });
  it('an unknown domain → the domain itself, known: false — never "OTHER"', () => {
    expect(companyOf('someone@example-forwarder.com')).toEqual({ name: 'example-forwarder.com', domain: 'example-forwarder.com', known: false });
    expect(companyOf('someone@example-forwarder.com').name).not.toBe('OTHER');
  });
  it('free-mail → the domain (gmail.com, yahoo.co.jp), not a company', () => {
    expect(companyOf('a@gmail.com')).toEqual({ name: 'gmail.com', domain: 'gmail.com', known: false });
    expect(companyOf('a@yahoo.co.jp').name).toBe('yahoo.co.jp');
    expect(companyOf('a@outlook.com').known).toBe(false);
  });
  it('null / empty / garbage → a dash with no domain', () => {
    expect(companyOf(null)).toEqual({ name: '—', domain: null, known: false });
    expect(companyOf(undefined).domain).toBeNull();
    expect(companyOf('')).toEqual({ name: '—', domain: null, known: false });
    expect(companyOf('not an address').domain).toBeNull();
    expect(companyOf('@').domain).toBeNull();
  });
  it('every built-in key is a lower-case apex-style domain', () => {
    for (const k of Object.keys(DEFAULT_COMPANIES)) expect(k).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
  });
});

describe('cleanCompanyOverrides (Settings → Email filter → Companies)', () => {
  it('lower-cases domains, trims names, drops a leading @', () => {
    expect(cleanCompanyOverrides({ 'Isewan.co.jp': ' Isewan ', '@hoei.example.jp': 'Hoei' }, fail)).toEqual({ 'isewan.co.jp': 'Isewan', 'hoei.example.jp': 'Hoei' });
  });
  it('refuses a bad domain, an empty / too long name, a non-object, more than 200 rows', () => {
    expect(() => cleanCompanyOverrides({ isewan: 'Isewan' }, fail)).toThrow('not an email domain');
    expect(() => cleanCompanyOverrides({ 'isewan.co.jp': '' }, fail)).toThrow('1–60 characters');
    expect(() => cleanCompanyOverrides({ 'isewan.co.jp': 'x'.repeat(61) }, fail)).toThrow('1–60 characters');
    expect(() => cleanCompanyOverrides(['isewan.co.jp'], fail)).toThrow('must map a domain');
    expect(() => cleanCompanyOverrides(null, fail)).toThrow('must map a domain');
    const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`d${i}.example.com`, `Company ${i}`]));
    expect(() => cleanCompanyOverrides(many, fail)).toThrow('At most 200');
  });
  it('an empty object clears the list', () => {
    expect(cleanCompanyOverrides({}, fail)).toEqual({});
  });
});

describe('companyOverridesOf (docDefaults.emailCompanies)', () => {
  it('reads the stored map and ignores anything that is not a text name', () => {
    expect(companyOverridesOf({ emailCompanies: { 'Isewan.co.jp': 'Isewan', 'x.com': 3, 'y.com': '' } })).toEqual({ 'isewan.co.jp': 'Isewan' });
    expect(companyOverridesOf({})).toEqual({});
    expect(companyOverridesOf(null)).toEqual({});
    expect(companyOverridesOf({ emailCompanies: ['a'] })).toEqual({});
  });
});
