import { cleanCompany, cleanContacts, cleanLogistics, cleanShippingLine, companyView, keepAccount, lineCode, maskAccount, maskedSettings } from './clients-company';
import { mergeProfiles, mergeSupplierProfiles } from './trade-profile';
import { carrierCatalog } from './trade-carrier';

// Round AY part 3 — Clients: company details, contacts, logistics, shipping lines.
const fail = (m: string): never => {
  throw new Error(m);
};
const CUST = 'a4ccfa28-9f64-468e-a943-e96ce8f8c3a0';

describe('round AY — company details', () => {
  it('cleans the company: country / website / terms / bank / notes; a bad website is refused', () => {
    expect(cleanCompany({ country: ' Japan ', website: 'https://katokei.co.jp', paymentTerms: 'TT 30 days', notes: 'x' }, undefined, fail)).toEqual({ country: 'Japan', website: 'https://katokei.co.jp', paymentTerms: 'TT 30 days', notes: 'x' });
    expect(() => cleanCompany({ website: 'not a site' }, undefined, fail)).toThrow('web address');
  });
  it('the bank account is shown masked and a masked / empty number keeps the stored one', () => {
    const stored = { bank: { bankName: 'MUFG', accountNo: '1234567890' } };
    expect(maskAccount('1234567890')).toBe('••••7890');
    expect(companyView(stored).bank!.accountNo).toBe('••••7890');
    expect(cleanCompany({ bank: { bankName: 'MUFG', accountNo: '••••7890' } }, stored, fail).bank!.accountNo).toBe('1234567890');
    expect(cleanCompany({ bank: { bankName: 'MUFG', accountNo: '' } }, stored, fail).bank!.accountNo).toBe('1234567890');
    expect(cleanCompany({ bank: { bankName: 'MUFG', accountNo: '555' } }, stored, fail).bank!.accountNo).toBe('555');
    expect(keepAccount({ bank: { accountNo: '••••7890' } }, stored)!.bank!.accountNo).toBe('1234567890');
  });
  it('Org Settings (GET / PATCH) only ever sends the masked number', () => {
    const s = maskedSettings({ customerProfiles: { [CUST]: { company: { bank: { accountNo: '1234567890' } } } }, supplierProfiles: {} });
    expect((s.customerProfiles as any)[CUST].company.bank.accountNo).toBe('••••7890');
  });
  it('a customer profile saved from Org Settings (no company / logistics keys) keeps them; a masked number never overwrites', () => {
    const base = { billingMode: 'SINGLE', truckCapacityT: 10, docVariants: {} };
    const stored = mergeProfiles({}, { [CUST]: { ...base, company: { country: 'Japan', bank: { accountNo: '1234567890' } }, logistics: { carriers: ['WANHAI'] } } }, fail);
    const again = mergeProfiles(stored, { [CUST]: { ...base, port: 'Nagoya' } }, fail);
    expect(again[CUST].company).toEqual({ country: 'Japan', bank: { accountNo: '1234567890' } });
    expect(again[CUST].logistics).toEqual({ carriers: ['WANHAI'] });
    const masked = mergeProfiles(stored, { [CUST]: { ...base, company: { country: 'Japan', bank: { accountNo: '••••7890' } } } }, fail);
    expect(masked[CUST].company!.bank!.accountNo).toBe('1234567890');
  });
  it('a supplier profile takes company / logistics / contacts and keeps everything else', () => {
    const sid = '11111111-2222-4333-8444-555555555555';
    const out = mergeSupplierProfiles({ [sid]: { supplierId: sid, hasPI: false, label: 'SIAE' } }, { [sid]: { company: { country: 'ID' }, contacts: [{ id: 'c1', name: 'Budi' }] } }, fail);
    expect(out[sid]).toMatchObject({ hasPI: false, label: 'SIAE', company: { country: 'ID' }, contacts: [{ id: 'c1', name: 'Budi' }] });
  });
});

describe('round AY — contacts and logistics', () => {
  it('contacts need a name; e-mail checked; language ja / en; main contact', () => {
    expect(cleanContacts([{ name: ' 佐藤 ', role: '購買', email: 'sato@example.jp', lang: 'ja', isPrimary: true }], fail)).toEqual([{ name: '佐藤', role: '購買', email: 'sato@example.jp', lang: 'ja', isPrimary: true }]);
    expect(() => cleanContacts([{ email: 'x@y.z' }], fail)).toThrow('needs a name');
    expect(() => cleanContacts([{ name: 'A', email: 'nope' }], fail)).toThrow('not an e-mail');
    expect(() => cleanContacts([{ name: 'A', lang: 'fr' }], fail)).toThrow('ja or en');
  });
  it('logistics: known shipping lines only, patterns must be valid, incoterms from the list', () => {
    const known = new Set(carrierCatalog().map((c) => c.code));
    expect(cleanLogistics({ carriers: ['WANHAI', 'WANHAI', 'MAERSK'], blPattern: '^198[A-Z]{2}\\d{5}$', portOfDischarge: 'Nagoya', incoterm: 'cif' }, known, fail)).toEqual({ carriers: ['WANHAI', 'MAERSK'], blPattern: '^198[A-Z]{2}\\d{5}$', portOfDischarge: 'Nagoya', incoterm: 'CIF' });
    expect(() => cleanLogistics({ carriers: ['NOPE'] }, known, fail)).toThrow('shipping line codes');
    expect(() => cleanLogistics({ blPattern: '[' }, known, fail)).toThrow('pattern');
    expect(() => cleanLogistics({ incoterm: 'XYZ' }, known, fail)).toThrow('incoterm');
  });
});

describe('round AY — shipping lines', () => {
  it('the catalogue lists the lines AIMS knows by their B/L (Wan Hai, KMTC, MSC, SITC, RCL, Evergreen, Maersk)', () => {
    expect(carrierCatalog().map((c) => c.code).sort()).toEqual(['EVERGREEN', 'KMTC', 'MAERSK', 'MSC', 'RCL', 'SITC', 'WANHAI']);
  });
  it('a line: name, links (http/https), agents, free time (whole days), notes', () => {
    const l = cleanShippingLine({ name: 'Wan Hai Lines', website: 'https://www.wanhai.com', agents: [{ company: 'Wan Hai Lines (Japan)', name: 'Tanaka', email: 'tanaka@wanhai.example' }], freeTime: { detDays: '4', demDays: 10, note: 'calendar days' }, notes: 'A/N ~2 days before ETA' }, undefined, fail);
    expect(l).toEqual({ name: 'Wan Hai Lines', website: 'https://www.wanhai.com', agents: [{ name: 'Tanaka', company: 'Wan Hai Lines (Japan)', email: 'tanaka@wanhai.example' }], freeTime: { detDays: 4, demDays: 10, note: 'calendar days' }, notes: 'A/N ~2 days before ETA' });
    expect(() => cleanShippingLine({ name: 'X', website: 'www.x.com' }, undefined, fail)).toThrow('http');
    expect(() => cleanShippingLine({ name: 'X', freeTime: { detDays: 1.5 } }, undefined, fail)).toThrow('whole number');
    expect(() => cleanShippingLine({ website: 'https://x.com' }, undefined, fail)).toThrow('needs a name');
  });
  it('a new line gets a code from its name, unique', () => {
    expect(lineCode('Ocean Network Express', new Set())).toBe('OCEAN_NETWORK_EXPRESS');
    expect(lineCode('T.S. Lines', new Set(['T_S_LINES']))).toBe('T_S_LINES_2');
  });
});
