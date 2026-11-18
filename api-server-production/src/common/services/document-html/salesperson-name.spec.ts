import { renderDocumentHtml } from './index';
import { resolveDesign } from './design';
import { printableSalesman } from './shared';
import { DocumentsService } from '../../../documents/documents.service';

/** A salesperson stored as a bare user id (a salesman with no code) never prints the id (2026-11-18, all orgs). */
const ID = 'user_3Ld8L6i0KO2BXMybjx5mYkWUdoh';
const org = { name: 'Org', address: 'Addr', registrationNumber: 'R1' };
const doc = (type: string, design: any, info: any) => ({
  documentType: type, name: 'D-1', organization: org, customer: { name: 'TEST Client' },
  items: [{ description: 'Line', quantity: 1, unitPrice: 10, amount: 10 }], design,
  documentInfo: { documentNumber: 'D-1', date: '2026-11-18', currency: 'SGD', ...info },
});
const render = (type: string, design: any, info: any) => renderDocumentHtml(type, doc(type, design, info), org)!;
const CASES: Array<[string, any]> = [
  ['QUOTATION', resolveDesign({ layout: 'wct' })],
  ['INVOICE', resolveDesign({ layout: 'wct' })],
  ['INVOICE', resolveDesign(null)],
  ['CREDIT_NOTE', resolveDesign(null)],
  ['DELIVERY_ORDER', resolveDesign({ layout: 'legacy-do' })],
];

describe('printableSalesman', () => {
  it('a code prints as is; a user id prints its name, else nothing', () => {
    expect(printableSalesman('S004', 'Nee Meng Tan')).toBe('S004');
    expect(printableSalesman(ID, 'Nee Meng WCTR')).toBe('Nee Meng WCTR');
    expect(printableSalesman(ID, '')).toBe('');
    expect(printableSalesman(ID)).toBe('');
    expect(printableSalesman(undefined, 'X')).toBe('');
  });
});

describe('renderers never print a salesperson user id', () => {
  it.each(CASES)('%s (%o): the id never prints; the name does when known', (type, design) => {
    const bare = render(type, design, { salesPerson: ID });
    expect(bare).not.toContain(ID);
    const named = render(type, design, { salesPerson: ID, salesPersonName: 'Nee Meng WCTR' });
    expect(named).not.toContain(ID);
    expect(named).toContain('Nee Meng WCTR');
  });
  it.each(CASES)('%s (%o): a salesman code prints exactly as before', (type, design) => {
    const h = render(type, design, { salesPerson: 'S004' });
    expect(h).toContain('S004');
  });
});

describe('DocumentsService.withSalesPersonName', () => {
  const svc = (users: Record<string, any>, calls: string[][] = []) => {
    const s: any = Object.create(DocumentsService.prototype);
    s.clerkIdentity = { toClerkUsers: async (ids: string[]) => (calls.push(ids), new Map(ids.filter((i) => users[i]).map((i) => [i, users[i]]))) };
    return s as DocumentsService;
  };
  it('fills the name of a user id with no saved name (flat and documentInfo)', async () => {
    const out: any = await svc({ [ID]: { firstName: 'Nee Meng', lastName: 'WCTR' } }).withSalesPersonName({ salesPerson: ID, documentInfo: { salesPerson: ID } });
    expect(out.salesPersonName).toBe('Nee Meng WCTR');
    expect(out.documentInfo.salesPersonName).toBe('Nee Meng WCTR');
  });
  it('leaves a code, a saved name, an unknown user and a lookup failure unchanged (and does not look up a code)', async () => {
    const calls: string[][] = [];
    const s = svc({ [ID]: { firstName: 'A' } }, calls);
    const code = { salesPerson: 'S004' };
    expect(await s.withSalesPersonName(code)).toBe(code);
    const saved = { salesPerson: ID, salesPersonName: 'Saved' };
    expect(await s.withSalesPersonName(saved)).toBe(saved);
    expect(calls).toEqual([]);
    const unknown = { salesPerson: 'user_nobody' };
    expect(await s.withSalesPersonName(unknown)).toBe(unknown);
    const broken: any = Object.create(DocumentsService.prototype);
    broken.clerkIdentity = { toClerkUsers: async () => { throw new Error('clerk down'); } };
    const c = { salesPerson: ID };
    expect(await broken.withSalesPersonName(c)).toBe(c);
  });
});
