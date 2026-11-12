import { DocumentsService } from './documents.service';

// DO first, product lines (2026-11-13): units picked at Complete DO are bound to the DO's product rows.
function make(items: any[], invs: any[], taken = false) {
  const writes: any[] = [];
  const tx: any = {
    inventory: { updateMany: jest.fn(async (a: any) => (writes.push(['reserve', a.where.id]), { count: taken ? 0 : 1 })) },
    document: { update: jest.fn(async (a: any) => writes.push(['doc', a.data.config])) },
  };
  const prisma: any = {
    document: { findFirst: jest.fn(async () => ({ id: 'd1', name: 'DO202611030', config: { orderId: 'o1', items } })) },
    inventory: { findMany: jest.fn(async () => invs) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const svc: any = Object.create(DocumentsService.prototype);
  const sync = jest.fn(async () => undefined);
  Object.assign(svc, { prisma, syncDocumentItems: sync });
  return { svc: svc as DocumentsService, writes, sync };
}
const ROWS = [{ assetId: 'a1', description: 'UVC emitter' }, { assetId: 'a1', description: 'UVC emitter' }, { description: 'Service' }];
const U = (id: string, over: any = {}) => ({ id, assetId: 'a1', status: 'instock', sku: `SKU-${id}`, serialNumber: `SN-${id}`, ...over });

describe('bindDoUnits', () => {
  it('one unit per product row, reserved, serial on the line, DO lines re-synced', async () => {
    const { svc, writes, sync } = make(ROWS, [U('u1'), U('u2')]);
    const out = await svc.bindDoUnits('d1', 'org', [{ assetId: 'a1', inventoryId: 'u1' }, { assetId: 'a1', inventoryId: 'u2' }]);
    expect(out).toEqual({ bound: 2 });
    expect(writes.filter((w) => w[0] === 'reserve').map((w) => w[1])).toEqual(['u1', 'u2']);
    const items = writes.find((w) => w[0] === 'doc')[1].items;
    expect(items.map((i: any) => i.inventoryItemId ?? null)).toEqual(['u1', 'u2', null]);
    expect(items[0].serialNumber).toBe('SN-u1');
    expect(sync).toHaveBeenCalled();
  });

  it('refuses a missing pick, a duplicate, a unit of another product, or one not in stock', async () => {
    await expect(make(ROWS, [U('u1')]).svc.bindDoUnits('d1', 'org', [{ inventoryId: 'u1' }])).rejects.toThrow(/every product line/);
    await expect(make(ROWS, [U('u1')]).svc.bindDoUnits('d1', 'org', [{ inventoryId: 'u1' }, { inventoryId: 'u1' }])).rejects.toThrow(/twice/);
    await expect(make(ROWS, [U('u1'), U('u2', { assetId: 'zz' })]).svc.bindDoUnits('d1', 'org', [{ inventoryId: 'u1' }, { inventoryId: 'u2' }])).rejects.toThrow(/Pick a unit of/);
    await expect(make(ROWS, [U('u1'), U('u2', { status: 'rental' })]).svc.bindDoUnits('d1', 'org', [{ inventoryId: 'u1' }, { inventoryId: 'u2' }])).rejects.toThrow(/not in stock/);
  });

  it('a unit taken at the same moment is refused (nothing written to the DO)', async () => {
    const { svc, writes } = make(ROWS, [U('u1'), U('u2')], true);
    await expect(svc.bindDoUnits('d1', 'org', [{ inventoryId: 'u1' }, { inventoryId: 'u2' }])).rejects.toThrow(/just taken/);
    expect(writes.some((w) => w[0] === 'doc')).toBe(false);
  });

  it('a DO with no product rows needs no units', async () => {
    expect(await make([{ description: 'Service' }], []).svc.bindDoUnits('d1', 'org', [])).toEqual({ bound: 0 });
  });
});
