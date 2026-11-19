import { allowsRdoFreeRows, hasUnit, isRdoSigned, isRdoType } from './rdo-free-rows';

describe('RDO free-typed rows (enableRdoFreeTypedRows)', () => {
  it('lets an RDO keep rows with no unit when the flag is on', () => {
    expect(allowsRdoFreeRows('RETURN_DELIVERY_ORDER', true)).toBe(true);
    expect(allowsRdoFreeRows('RDO', true)).toBe(true);
  });

  it('keeps the unit-on-every-row rule with the flag off (WCT and every other org)', () => {
    expect(allowsRdoFreeRows('RETURN_DELIVERY_ORDER', false)).toBe(false);
    expect(allowsRdoFreeRows('RDO', false)).toBe(false);
  });

  it('never relaxes a DO or any other type, flag or not', () => {
    for (const t of ['DO', 'DELIVERY_ORDER', 'INVOICE', 'QUOTATION', '', null, undefined]) {
      expect(allowsRdoFreeRows(t as any, true)).toBe(false);
    }
    expect(isRdoType('rdo')).toBe(true);
  });

  it('tells a unit row from a free-typed row (auto-made RDO rows carry no inventoryItemId key)', () => {
    expect(hasUnit({ inventoryItemId: 'inv-1' })).toBe(true);
    expect(hasUnit({ description: 'AF40', quantity: 1, unitPrice: 0, amount: 0 })).toBe(false);
    expect(hasUnit({ inventoryItemId: '' })).toBe(false);
    expect(hasUnit({ inventoryItemId: '  ' })).toBe(false);
  });
});

describe('isRdoSigned', () => {
  const prisma = (runs: Array<{ id: string; status: string }>, signedCount: number) => {
    const calls: any[] = [];
    return {
      calls,
      delivery: { findMany: async (args: any) => (calls.push(['runs', args]), runs) },
      maintenanceServiceReport: { count: async (args: any) => (calls.push(['acks', args]), signedCount) },
    };
  };

  it('is signed once its run is completed', async () => {
    expect(await isRdoSigned(prisma([{ id: 'r1', status: 'completed' }], 0), 'org', 'doc')).toBe(true);
  });

  it('is signed when a signed DO_ACK sits on the RDO or its run', async () => {
    const p = prisma([{ id: 'r1', status: 'in_progress' }], 1);
    expect(await isRdoSigned(p, 'org', 'doc')).toBe(true);
    const where = p.calls.find((c) => c[0] === 'acks')[1].where;
    expect(where).toMatchObject({ organizationId: 'org', kind: 'DO_ACK', signature: { not: null } });
    expect(where.OR).toEqual([{ documentId: 'doc' }, { deliveryId: { in: ['r1'] } }]);
  });

  it('stays editable with no signature and no completed run', async () => {
    expect(await isRdoSigned(prisma([{ id: 'r1', status: 'scheduled' }], 0), 'org', 'doc')).toBe(false);
    expect(await isRdoSigned(prisma([], 0), 'org', 'doc')).toBe(false);
  });

  it('scopes the run lookup to the org', async () => {
    const p = prisma([], 0);
    await isRdoSigned(p, 'org-a', 'doc');
    expect(p.calls[0][1].where.organizationId).toBe('org-a');
  });
});
