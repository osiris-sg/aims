import { BadRequestException } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { currentStepOf, depositOf, lineLabel, linesSummary, tradeToday } from './shipments.rules';
import { ShipmentsService } from './shipments.service';

const ORG = 'org-1';
const actor = { id: 'u1', name: 'Tester' };

describe('currentStepOf', () => {
  const st = (code: string, sortOrder: number, status = 'NOT_STARTED', isOngoing = false) => ({ code, title: code.toLowerCase(), sortOrder, status, isOngoing });
  it('is the first non-ongoing step not DONE, numbered by its place among counted steps', () => {
    const steps = [st('C', 30), st('A', 10, 'DONE'), st('ONGOING', 5, 'NOT_STARTED', true), st('B', 20, 'IN_PROGRESS')];
    expect(currentStepOf(steps)).toEqual({ code: 'B', title: 'b', position: 2, displayNo: null, label: '2. b' });
  });
  it('is null ("Completed") when every counted step is done, ignoring ongoing ones', () => {
    expect(currentStepOf([st('A', 10, 'DONE'), st('O', 99, 'IN_PROGRESS', true)])).toBeNull();
  });
});

describe('product line summaries', () => {
  it('"6063 · 300 MT", comma-joined in line order', () => {
    expect(
      linesSummary([
        { grade: '6063', quantityMt: '300.000', sortOrder: 2 },
        { grade: '6005', quantityMt: 50, sortOrder: 1 },
      ]),
    ).toBe('6005 · 50 MT, 6063 · 300 MT');
    expect(linesSummary([])).toBeNull();
    expect(lineLabel({ grade: '6063', sizeSpec: '152MM', quantityMt: 30 })).toBe('6063 · 152MM · 30 MT');
  });
  it('deposit = PI amount × percent', () => {
    expect(depositOf(123456.78, 10)).toBe(12345.68);
    expect(depositOf(null, 10)).toBeNull();
  });
});

describe('tradeToday (Asia/Tokyo calendar day)', () => {
  it('is already the next day in Tokyo between 00:00 and 09:00 JST (15:00–24:00 UTC)', () => {
    expect(tradeToday(new Date('2026-10-13T15:00:00Z'))).toBe('2026-10-14'); // 00:00 JST
    expect(tradeToday(new Date('2026-10-13T23:59:59Z'))).toBe('2026-10-14'); // 08:59 JST
    expect(tradeToday(new Date('2026-10-14T00:00:00Z'))).toBe('2026-10-14'); // 09:00 JST
  });
  it('is the same day just before Tokyo midnight', () => {
    expect(tradeToday(new Date('2026-10-13T14:59:59Z'))).toBe('2026-10-13'); // 23:59 JST
    expect(tradeToday(new Date('2026-12-31T15:30:00Z'))).toBe('2027-01-01'); // year rolls over in Tokyo first
  });
});

/** A tx mock good enough for ContractsService.create / update + syncLines. */
function contractDb(opts: { settings?: any; lines?: any[] } = {}) {
  const lines = [...(opts.lines ?? [])];
  const tx: any = {
    supplier: { findFirst: jest.fn().mockResolvedValue({ id: 'sup' }) },
    customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cus' }) },
    contract: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'c1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    contractLine: {
      findMany: jest.fn().mockImplementation(() => Promise.resolve(lines)),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    tradeSetting: { findUnique: jest.fn().mockResolvedValue(opts.settings ?? null) },
  };
  const prisma: any = { ...tx, $transaction: (fn: any) => fn(tx) };
  const config: any = {
    snapshotSteps: jest.fn(),
    getSettings: jest.fn().mockResolvedValue({ defaultConsignee: opts.settings?.defaultConsignee ?? null, defaultNotifyParty: opts.settings?.defaultNotifyParty ?? null }),
  };
  const svc = new ContractsService(prisma, config);
  jest.spyOn(svc, 'getById').mockResolvedValue({} as any);
  return { tx, svc };
}

describe('ContractsService — lines, B/L defaults, deposit', () => {
  const base = { contractNo: '454003598', supplierId: 'sup', customerId: 'cus' };

  it('creates the lines in order and defaults consignee / notify party from the org settings', async () => {
    const { tx, svc } = contractDb({ settings: { defaultConsignee: 'ADH JAPAN', defaultNotifyParty: 'ADH SG' } });
    await svc.create(
      ORG,
      {
        ...base,
        piAmount: 1000,
        lines: [
          { grade: '6005', sizeSpec: '203MM', quantityMt: 50 },
          { grade: '6063', sizeSpec: '152MM', quantityMt: 30, tolerancePct: 10 },
        ],
      } as any,
      actor,
    );
    const data = tx.contract.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ consignee: 'ADH JAPAN', notifyParty: 'ADH SG', depositAmount: 100 });
    expect(tx.contractLine.create.mock.calls.map((c: any) => [c[0].data.grade, c[0].data.sortOrder, c[0].data.tolerancePct])).toEqual([
      ['6005', 1, 5],
      ['6063', 2, 10],
    ]);
  });

  it('keeps consignee / notify party the user sent (even blank)', async () => {
    const { tx, svc } = contractDb({ settings: { defaultConsignee: 'ADH JAPAN', defaultNotifyParty: 'ADH SG' } });
    await svc.create(ORG, { ...base, consignee: 'OTHER CO', notifyParty: '', lines: [{ grade: '6063' }] } as any, actor);
    expect(tx.contract.create.mock.calls[0][0].data).toMatchObject({ consignee: 'OTHER CO', notifyParty: null });
  });

  it('refuses a contract with no product line', async () => {
    const { svc } = contractDb();
    await expect(svc.create(ORG, { ...base, lines: [] } as any, actor)).rejects.toThrow('Add at least one product line');
  });

  it('update: updates kept lines, creates new ones, deletes dropped ones', async () => {
    const { tx, svc } = contractDb({
      lines: [
        { id: 'L1', grade: '6005', sizeSpec: null, shipments: [] },
        { id: 'L2', grade: '6063', sizeSpec: null, shipments: [] },
      ],
    });
    tx.contract.findFirst.mockResolvedValueOnce({ id: 'c1', contractNo: '454003598' });
    await svc.update(ORG, 'c1', { lines: [{ id: 'L2', grade: '6063', quantityMt: 40 }, { grade: '6060' }] } as any);
    expect(tx.contractLine.delete).toHaveBeenCalledWith({ where: { id: 'L1' } });
    expect(tx.contractLine.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'L2' }, data: expect.objectContaining({ quantityMt: 40, sortOrder: 1 }) }));
    expect(tx.contractLine.create.mock.calls[0][0].data).toMatchObject({ grade: '6060', sortOrder: 2, contractId: 'c1' });
  });

  it('update: refuses to drop a line a shipment ships', async () => {
    const { tx, svc } = contractDb({
      lines: [
        { id: 'L1', grade: '6005', sizeSpec: '203MM', shipments: [{ blNumber: 'BL1' }] },
        { id: 'L2', grade: '6063', sizeSpec: null, shipments: [] },
      ],
    });
    tx.contract.findFirst.mockResolvedValueOnce({ id: 'c1', contractNo: '454003598' });
    await expect(svc.update(ORG, 'c1', { lines: [{ id: 'L2' }] } as any)).rejects.toThrow("Can't remove product line 6005 203MM: shipment(s) BL1 ship it");
    expect(tx.contractLine.delete).not.toHaveBeenCalled();
  });
});

describe('ShipmentsService.create — product line', () => {
  const L1 = { id: 'L1', grade: '6005', product: 'Aluminium Billet', sizeSpec: '203MM', quantityMt: 50 };
  const L2 = { id: 'L2', grade: '6063', product: 'Aluminium Billet', sizeSpec: '152MM', quantityMt: 30 };
  function setup(lines: any[]) {
    const tx: any = {
      contract: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', contractNo: 'C', status: 'OPEN', customerId: 'cus', currency: 'USD', deliveryMonth: '2026-09', lines }) },
      shipment: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 's1' }) },
    };
    const prisma: any = { $transaction: (fn: any) => fn(tx) };
    const svc = new ShipmentsService(prisma, { snapshotSteps: jest.fn() } as any);
    jest.spyOn(svc, 'getById').mockResolvedValue({} as any);
    return { tx, svc };
  }
  it('prefills commodity / size from the chosen line and delivery month from the contract', async () => {
    const { tx, svc } = setup([L1, L2]);
    await svc.create(ORG, { contractId: 'c1', contractLineId: 'L2' } as any, actor);
    expect(tx.shipment.create.mock.calls[0][0].data).toMatchObject({ contractLineId: 'L2', commodity: 'Aluminium Billet 6063', sizeSpec: '152MM', deliveryMonth: '2026-09' });
  });
  it('keeps edited commodity / size', async () => {
    const { tx, svc } = setup([L2]);
    await svc.create(ORG, { contractId: 'c1', commodity: 'Billet', sizeSpec: '6"' } as any, actor);
    expect(tx.shipment.create.mock.calls[0][0].data).toMatchObject({ contractLineId: 'L2', commodity: 'Billet', sizeSpec: '6"' });
  });
  it('requires a line when the contract has several, and refuses a line from another contract', async () => {
    await expect(setup([L1, L2]).svc.create(ORG, { contractId: 'c1' } as any, actor)).rejects.toThrow(BadRequestException);
    await expect(setup([L1, L2]).svc.create(ORG, { contractId: 'c1' } as any, actor)).rejects.toThrow('several product lines');
    await expect(setup([L1]).svc.create(ORG, { contractId: 'c1', contractLineId: 'other' } as any, actor)).rejects.toThrow('not on this shipment');
  });
});
