import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LotAccountingService } from './lot-accounting.service';

// Round BW — ADH Admin types SUS Invoice #1 (USD) when AIMS has none: both amounts required, nothing guessed.
describe('LotAccountingService.saveInvoice1', () => {
  const make = (booksInput: unknown) => {
    const update = jest.fn(async () => ({}));
    const prisma: any = { tradeOrder: { findFirst: jest.fn(async () => (booksInput === 'none' ? null : { id: 'o1', booksInput })), update } };
    return { svc: new LotAccountingService(prisma, {} as any), update };
  };
  const actor = { id: 'u1', name: 'Take' };

  it('stores principal + tax as typed (2dp), keeps other keys, stamps who', async () => {
    const { svc, update } = make({ other: 1 });
    const r = await svc.saveInvoice1('org', 'o1', { principal: '1134294', tax: 113429.4, number: ' INV-1 ' }, actor);
    expect(r.invoice1).toMatchObject({ principal: 1134294, tax: 113429.4, number: 'INV-1', byName: 'Take' });
    expect((update.mock.calls[0] as any[])[0].data.booksInput).toMatchObject({ other: 1, invoice1: { principal: 1134294, tax: 113429.4 } });
  });

  it('refuses a missing tax or a non-positive principal (never fills one in)', async () => {
    const { svc, update } = make(null);
    await expect(svc.saveInvoice1('org', 'o1', { principal: 1000 }, actor)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.saveInvoice1('org', 'o1', { principal: 0, tax: 0 }, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('principal: null clears the typed amounts only', async () => {
    const { svc, update } = make({ other: 1, invoice1: { principal: 1, tax: 0 } });
    expect(await svc.saveInvoice1('org', 'o1', { principal: null }, actor)).toEqual({ invoice1: null });
    expect((update.mock.calls[0] as any[])[0].data.booksInput).toEqual({ other: 1 });
  });

  it('another org’s order is not found', async () => {
    const { svc } = make('none');
    await expect(svc.saveInvoice1('org', 'x', { principal: 1, tax: 0 }, actor)).rejects.toBeInstanceOf(NotFoundException);
  });
});
