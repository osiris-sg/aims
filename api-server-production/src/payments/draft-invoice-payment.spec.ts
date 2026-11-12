import { HttpException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

// postInvoicesOnConfirm (WCT group): no payment on a draft / unconfirmed invoice.
function run(opts: { flag: boolean; status: string; posted?: boolean }) {
  const document = { id: 'inv-1', name: 'INV-1', type: 'INVOICE', status: opts.status, config: { customerId: 'cust-1', nettTotal: 109, items: [{ amount: 100 }] } };
  const prisma: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features: opts.flag ? { postInvoicesOnConfirm: true } : {} })) },
    document: { findFirst: jest.fn(async () => document) },
    journalEntry: { findFirst: jest.fn(async () => (opts.posted ? { id: 'je-1' } : null)) },
    payment: { aggregate: jest.fn(async () => ({ _sum: { amount: 0 } })) },
    // Past the guards: stop at the transaction so the test needs no more mocks.
    $transaction: jest.fn(async () => {
      throw new Error('REACHED_TRANSACTION');
    }),
  };
  const svc = new PaymentsService(prisma, {} as any);
  return svc.create({ documentId: 'inv-1', customerId: 'cust-1', amount: 50 } as any, 'org', 'user-1');
}

const message = async (p: Promise<any>) => p.then(() => 'ok', (e: any) => (e instanceof HttpException ? `${e.getStatus()} ${e.message}` : e.message));

describe('payment on a draft invoice', () => {
  it('is blocked under the flag, draft or unconfirmed', async () => {
    expect(await message(run({ flag: true, status: 'unconfirmed' }))).toBe('400 Confirm or send the invoice first.');
    expect(await message(run({ flag: true, status: 'draft' }))).toBe('400 Confirm or send the invoice first.');
  });

  it('is blocked under the flag even if an old journal exists', async () => {
    expect(await message(run({ flag: true, status: 'unconfirmed', posted: true }))).toBe('400 Confirm or send the invoice first.');
  });

  it('is allowed once the invoice is confirmed or sent', async () => {
    expect(await message(run({ flag: true, status: 'confirmed' }))).toContain('REACHED_TRANSACTION');
    expect(await message(run({ flag: true, status: 'pending_payment' }))).toContain('REACHED_TRANSACTION');
  });

  it('without the flag a saved (posted) draft still takes a payment, as before', async () => {
    expect(await message(run({ flag: false, status: 'unconfirmed', posted: true }))).toContain('REACHED_TRANSACTION');
  });
});
