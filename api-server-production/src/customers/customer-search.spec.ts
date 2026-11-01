import { CustomersService } from './customers.service';

// Customers list / picker search (2026-11-02): UEN by substring, the old
// (previous-system) code whole — also as one part of a merged "228+229".
describe('getCustomers search', () => {
  const run = async (search: string) => {
    let where: any;
    const prisma = {
      customer: {
        findMany: async (args: any) => ((where = args.where), []),
        count: async () => 0,
      },
    };
    const svc = new CustomersService(prisma as any, { toClerkUsers: async () => new Map() } as any);
    await svc.getCustomers({ page: 1, limit: 20, search } as any, 'org');
    return where;
  };

  // Rows newest first, as the DB returns them; `exact` answers the exact-match query.
  const svcWith = (rows: any[], exact: any[]) => {
    const calls: any[] = [];
    const prisma = {
      customer: {
        findMany: async (args: any) => (calls.push(args), args.skip === undefined ? exact : rows.slice(0, args.take)),
        count: async () => rows.length,
      },
    };
    return { calls, svc: new CustomersService(prisma as any, { toClerkUsers: async () => new Map() } as any) };
  };
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: `n${i}`, name: `Row ${i}` }));

  it('exactFirst (pickers): an exact old-code hit leads, list stays at the limit', async () => {
    const { svc, calls } = svcWith(rows, [{ id: 'old', name: 'Old 449' }]);
    const res: any = await svc.getCustomers({ page: 1, limit: 20, search: '449', exactFirst: true } as any, 'org');
    const docs = res.docs ?? res.data?.docs ?? res.customers;
    expect(docs[0].id).toBe('old');
    expect(docs).toHaveLength(20);
    expect(calls[1].where.OR).toEqual(expect.arrayContaining([{ externalRef: { equals: '449' } }, { customerCode: { equals: '449', mode: 'insensitive' } }]));
  });

  it('no exactFirst (the paged Customers list): one query, server order', async () => {
    const { svc, calls } = svcWith(rows, [{ id: 'old' }]);
    const res: any = await svc.getCustomers({ page: 1, limit: 20, search: '449' } as any, 'org');
    const docs = res.docs ?? res.data?.docs ?? res.customers;
    expect(calls).toHaveLength(1);
    expect(docs[0].id).toBe('n0');
  });

  it('searches UEN and the old code next to the usual fields', async () => {
    const where = await run(' 449 ');
    expect(where.organizationId).toBe('org');
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { name: { contains: ' 449 ', mode: 'insensitive' } },
        { uen: { contains: ' 449 ', mode: 'insensitive' } },
        { externalRef: { equals: '449' } },
        { externalRef: { startsWith: '449+' } },
        { externalRef: { endsWith: '+449' } },
        { externalRef: { contains: '+449+' } },
      ]),
    );
  });

  it('adds no OR without a search term', async () => {
    expect((await run('')).OR).toBeUndefined();
  });
});
