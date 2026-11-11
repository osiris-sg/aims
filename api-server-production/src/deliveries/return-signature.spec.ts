jest.mock('../delivery-group-posts/enqueue', () => ({ enqueueDeliveryGroupPost: jest.fn(async () => null) }));
// The run lease is raw SQL on a real database (run-lease.ts; covered by the dev concurrency e2e): run straight through here.
jest.mock('./run-lease', () => ({ withRunLease: (_prisma: unknown, _lease: unknown, fn: () => Promise<unknown>) => fn() }));

import { DeliveriesService } from './deliveries.service';

/**
 * A return's customer signature must always land on a proof row (2026-11-11,
 * Biofuel RDO202611-002/003: a return of free-typed lines only had no DO_ACK,
 * so finalizeReturn's signature was dropped while the call answered 200).
 * Built without Nest over a small in-memory store: only the members the
 * collect and the finalize touch are provided.
 */
type Msr = Record<string, any>;
type Item = { id: string; inventoryId: string | null; assetId: string | null; description: string; deliveryStatus: string };

function matches(row: Msr, where: Record<string, any>) {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
    if (v && typeof v === 'object' && 'not' in v) return row[k] !== v.not;
    if (v === null) return row[k] == null;
    return row[k] === v;
  });
}

function service(opts: { runStatus: string; items: Item[]; msrs?: Msr[] }) {
  const msrs: Msr[] = opts.msrs ?? [];
  const items = opts.items;
  const run = { id: 'run-1', status: opts.runStatus, direction: 'RETURN', riderUserId: 'rider-1', projectId: null };
  const prisma: any = {
    delivery: {
      findFirst: async () => run,
      findUnique: async () => run,
    },
    deliveryItem: {
      findFirst: async ({ where }: any) => items.find((i) => matches(i, { ...where, deliveryId: undefined })) ?? null,
      findMany: async ({ where }: any) => items.filter((i) => matches(i, { deliveryStatus: where.deliveryStatus })).map((i) => ({ id: i.id })),
      findUnique: async ({ where }: any) => items.find((i) => i.id === where.id) ?? null,
      updateMany: async ({ where, data }: any) => {
        const hit = items.filter((i) => matches(i, { ...where, deliveryId: undefined }));
        hit.forEach((i) => Object.assign(i, data));
        return { count: hit.length };
      },
    },
    maintenanceServiceReport: {
      create: async ({ data }: any) => {
        const row = { status: 'draft', signature: null, ...data };
        msrs.push(row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const hit = msrs.filter((m) => matches(m, where));
        hit.forEach((m) => Object.assign(m, data));
        return { count: hit.length };
      },
    },
  };
  // matches() treats an undefined filter as "row[k] === undefined": drop it.
  for (const k of ['findFirst', 'updateMany'] as const) {
    const fn = prisma.deliveryItem[k];
    prisma.deliveryItem[k] = (args: any) => {
      const { deliveryId: _d, ...where } = args.where;
      return fn({ ...args, where });
    };
  }
  prisma.$transaction = async (fn: (tx: any) => Promise<unknown>) => fn(prisma);
  const svc: any = Object.create(DeliveriesService.prototype);
  svc.prisma = prisma;
  svc.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
  svc.recomputeRunStatus = jest.fn(async () => {
    if (items.every((i) => i.deliveryStatus !== 'delivering' && i.deliveryStatus !== 'not_installed')) run.status = 'completed';
  });
  svc.orderFollowsRun = jest.fn(async () => undefined);
  svc.offHireFreeTypedDeployment = jest.fn(async () => undefined);
  svc.siteclock = null;
  return { svc, msrs, items, run };
}

const SIG = 'data:image/png;base64,iVBORw0KGgo=';

describe('return signature always lands on a proof row', () => {
  it('free-typed-only return: the collect writes an unsigned DO_ACK and finalize signs it', async () => {
    const { svc, msrs, run } = service({
      runStatus: 'in_progress',
      items: [{ id: 'line-1', inventoryId: null, assetId: null, description: 'Genset 60kVA', deliveryStatus: 'delivering' }],
    });
    await svc.collectReturnFreeTyped('run-1', 'line-1', 'org-1', { technicianUserId: 'rider-1', description: 'Return collected (bulk)' });
    expect(msrs).toEqual([
      expect.objectContaining({ kind: 'DO_ACK', status: 'draft', signature: null, deliveryItemId: 'line-1', assetId: null, inventoryId: null }),
    ]);

    // A second collect of the same line (retry, another device) writes no second proof.
    await svc.collectReturnFreeTyped('run-1', 'line-1', 'org-1', { technicianUserId: 'rider-1' });
    expect(msrs).toHaveLength(1);

    run.status = 'delivered';
    await svc.finalizeReturn('run-1', { signature: SIG, recipientName: 'Chua' }, 'org-1', 'rider-1');
    expect(msrs).toHaveLength(1);
    expect(msrs[0]).toMatchObject({ kind: 'DO_ACK', status: 'completed', signature: SIG, signedByName: 'Chua' });
    expect(msrs[0].signedAt).toBeInstanceOf(Date);
    expect(svc.logger.warn).not.toHaveBeenCalled();
  });

  it('mixed return: a proof already completed without a signature still takes it, with the free-typed one', async () => {
    const { svc, msrs } = service({
      runStatus: 'delivered',
      items: [
        { id: 'unit-line', inventoryId: 'inv-1', assetId: 'a-1', description: 'Genset', deliveryStatus: 'not_installed' },
        { id: 'free-line', inventoryId: null, assetId: null, description: 'Cable', deliveryStatus: 'not_installed' },
      ],
      msrs: [
        { deliveryId: 'run-1', kind: 'DO_START', status: 'draft', signature: null },
        { deliveryId: 'run-1', kind: 'DO_ACK', status: 'completed', signature: null, deliveryItemId: 'unit-line' },
        { deliveryId: 'run-1', kind: 'DO_ACK', status: 'draft', signature: null, deliveryItemId: 'free-line' },
      ],
    });
    await svc.finalizeReturn('run-1', { signature: SIG, recipientName: 'Jaime' }, 'org-1', 'rider-1');
    const acks = msrs.filter((m) => m.kind === 'DO_ACK');
    expect(acks).toHaveLength(2);
    acks.forEach((m) => expect(m).toMatchObject({ status: 'completed', signature: SIG, signedByName: 'Jaime' }));
    expect(msrs[0]).toMatchObject({ kind: 'DO_START', signature: null }); // starts are never signed
  });

  it('no proof row at all: the signature gets its own run-level DO_ACK, with a warning', async () => {
    const { svc, msrs } = service({
      runStatus: 'delivered',
      items: [{ id: 'line-1', inventoryId: null, assetId: null, description: 'Genset', deliveryStatus: 'not_installed' }],
      msrs: [{ deliveryId: 'run-1', kind: 'DO_START', status: 'draft', signature: null }],
    });
    await svc.finalizeReturn('run-1', { signature: SIG, recipientName: 'Chua', technicianName: 'Ali' }, 'org-1', 'rider-1');
    const acks = msrs.filter((m) => m.kind === 'DO_ACK');
    expect(acks).toEqual([
      expect.objectContaining({
        deliveryId: 'run-1',
        organizationId: 'org-1',
        technicianUserId: 'rider-1',
        assetId: null,
        inventoryId: null,
        status: 'completed',
        signature: SIG,
        signedByName: 'Chua',
        technicianName: 'Ali',
      }),
    ]);
    expect(svc.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('re-sign attempt on a finalized return is refused and changes nothing', async () => {
    const signedAt = new Date('2026-11-10T10:26:09Z');
    const { svc, msrs } = service({
      runStatus: 'completed',
      items: [{ id: 'line-1', inventoryId: null, assetId: null, description: 'Genset', deliveryStatus: 'completed' }],
      msrs: [{ deliveryId: 'run-1', kind: 'DO_ACK', status: 'completed', signature: SIG, signedByName: 'Chua', signedAt }],
    });
    await expect(
      svc.finalizeReturn('run-1', { signature: 'data:image/png;base64,OTHER', recipientName: 'Someone' }, 'org-1', 'rider-1'),
    ).rejects.toThrow(/already finalized/);
    expect(msrs).toHaveLength(1);
    expect(msrs[0]).toMatchObject({ signature: SIG, signedByName: 'Chua', signedAt });
  });
});

describe('stampRunSignature (shared by finalizeRun and finalizeReturn)', () => {
  it('never re-signs a row that already has a signature', async () => {
    const first = 'data:image/png;base64,FIRST';
    const { svc, msrs } = service({
      runStatus: 'delivered',
      items: [],
      msrs: [
        { deliveryId: 'run-1', kind: 'DO_INSTALL', status: 'completed', signature: first },
        { deliveryId: 'run-1', kind: 'DO_ACK', status: 'draft', signature: null },
      ],
    });
    const n = await svc.stampRunSignature('run-1', 'org-1', 'rider-1', ['DO_ACK', 'DO_INSTALL'], { signature: SIG }, new Date());
    expect(n).toBe(1);
    expect(msrs[0].signature).toBe(first);
    expect(msrs[1]).toMatchObject({ signature: SIG, status: 'completed' });
  });
});
