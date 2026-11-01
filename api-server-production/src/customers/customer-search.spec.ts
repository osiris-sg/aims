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
