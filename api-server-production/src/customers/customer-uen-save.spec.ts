import { CustomersService } from './customers.service';

// Task D (2026-11-17): the UEN saves from every customer form (create: Locate
// Customer "New Customer" + Customers drawer; update: Customers drawer edit),
// trimmed + upper case; payloads without a UEN (flag-off orgs) are untouched.
describe('customer UEN on create / update', () => {
  const make = () => {
    const writes: any[] = [];
    const prisma = {
      customer: {
        findMany: async () => [],
        findFirst: async () => ({ id: 'c1' }),
        create: async (args: any) => (writes.push(['create', args.data]), { id: 'c1', ...args.data }),
        update: async (args: any) => (writes.push(['update', args.data]), { id: args.where.id, ...args.data }),
      },
      customerContact: { findMany: async () => [] },
      $transaction: async (ops: any[]) => ops,
    };
    const svc = new CustomersService(prisma as any, { toClerkUsers: async () => new Map() } as any);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    return { svc, writes };
  };

  it('create (picker quick-add / drawer): UEN trimmed + upper-cased', async () => {
    const { svc, writes } = make();
    await svc.createCustomers({ name: 'Acme', phone: null, email: null, address: null, uen: ' 202414659r ' } as any, 'org');
    expect(writes[0][1]).toMatchObject({ name: 'Acme', uen: '202414659R', organizationId: 'org' });
  });

  it('create without a UEN (flag-off orgs): no uen key written', async () => {
    const { svc, writes } = make();
    await svc.createCustomers({ name: 'Acme', phone: null, email: null, address: null, gstRegNo: 'M90312345A' } as any, 'org');
    expect('uen' in writes[0][1]).toBe(false);
    expect(writes[0][1].gstRegNo).toBe('M90312345A');
  });

  it('update (drawer edit): UEN normalised, blank clears it', async () => {
    const { svc, writes } = make();
    await svc.updateCustomers({ id: 'c1', uen: 't08ll1234a ' } as any, 'org');
    await svc.updateCustomers({ id: 'c1', uen: '' } as any, 'org');
    expect(writes[0][1].uen).toBe('T08LL1234A');
    expect(writes[1][1].uen).toBeNull();
  });

  it('update without a UEN leaves the column alone', async () => {
    const { svc, writes } = make();
    await svc.updateCustomers({ id: 'c1', name: 'Acme 2' } as any, 'org');
    expect(writes[0][1]).toEqual({ name: 'Acme 2' });
  });
});
