import { CustomersService } from './customers.service';

// generateCustomerCode: C + first letter + max-based number (no counter).
const svcWith = (codes: string[]) =>
  new CustomersService(
    {
      customer: {
        findMany: async ({ where }: any) => codes.filter((c) => c.startsWith(where.customerCode.startsWith)).map((customerCode) => ({ customerCode })),
      },
    } as any,
    null as any,
  );
const next = (codes: string[], name: string) => (svcWith(codes) as any).generateCustomerCode(name, 'org');

describe('generateCustomerCode', () => {
  it('takes max + 1 and keeps counting past 999', async () => {
    expect(await next([], 'acme')).toBe('CA001');
    expect(await next(['CA001', 'CA007', 'CAX'], 'Acme')).toBe('CA008');
    expect(await next(['CS999'], 'Sun')).toBe('CS1000');
    expect(await next(['CS999', 'CS1000', 'CS1041'], 'Sun')).toBe('CS1042');
  });

  it('skips leading punctuation; non-Latin names go to CX', async () => {
    expect(await next(['CP004'], '+Plus Cafe')).toBe('CP005');
    expect(await next([], '(EBT) Ong Chu Wa')).toBe('CE001');
    expect(await next(['CL002'], '#Letter Pte Ltd')).toBe('CL003');
    expect(await next(['C1009'], '  118 Coffee')).toBe('C1010');
    expect(await next(['CX009'], '天府人家')).toBe('CX010');
    expect(await next([], 'Électricité')).toBe('CE001');
    expect(await next([], '')).toBe('CX001');
  });

  it('matches the prefix literally (legacy codes with punctuation are ignored)', async () => {
    expect(await next(['C(001', 'C+001', 'CP001'], '+Plus')).toBe('CP002');
  });
});
