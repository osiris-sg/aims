import { BadRequestException, NotFoundException } from '@nestjs/common';
import { isPlaceholderDocName, purgeBlocker, PurgeFacts } from './purge-guard';
import { DeliveriesService } from './deliveries.service';

const line = (over: Partial<PurgeFacts['items'][number]> = {}) => ({
  inventoryId: null,
  deliveryStatus: 'not_delivered',
  deliveringAt: null,
  deliveredAt: null,
  completedAt: null,
  ...over,
});
const facts = (over: Partial<PurgeFacts> = {}): PurgeFacts => ({
  status: 'cancelled',
  isDraft: false,
  items: [line()],
  docs: [],
  invoices: 0,
  postedEntries: 0,
  reports: 0,
  groupPosts: 0,
  ...over,
});

describe('purgeBlocker (permanent delete of a cancelled run)', () => {
  it('allows a cancelled run that committed nothing, with or without its placeholder DO', () => {
    expect(purgeBlocker(facts())).toBeNull();
    expect(purgeBlocker(facts({ docs: [{ id: 'd', name: 'DO-PENDING-02', status: 'unconfirmed' }] }))).toBeNull();
    expect(purgeBlocker(facts({ docs: [{ id: 'd', name: 'RDO-PENDING-01', status: 'draft' }] }))).toBeNull();
  });

  it('refuses anything not cancelled', () => {
    for (const status of ['scheduled', 'in_progress', 'delivered', 'completed']) {
      expect(purgeBlocker(facts({ status }))).toMatch(/Only a cancelled delivery/);
    }
  });

  it('refuses a run that moved stock or saw field work', () => {
    expect(purgeBlocker(facts({ items: [line({ inventoryId: 'inv1' })] }))).toMatch(/stock moved/);
    expect(purgeBlocker(facts({ items: [line({ deliveredAt: new Date() })] }))).toMatch(/in the field/);
    expect(purgeBlocker(facts({ items: [line({ deliveryStatus: 'delivering' })] }))).toMatch(/in the field/);
    expect(purgeBlocker(facts({ reports: 1 }))).toMatch(/field reports/);
    expect(purgeBlocker(facts({ groupPosts: 1 }))).toMatch(/delivery group/);
  });

  it('refuses a real DO number, a confirmed placeholder, an invoice or a ledger post', () => {
    expect(purgeBlocker(facts({ docs: [{ id: 'd', name: 'DO-2026-0042', status: 'unconfirmed' }] }))).toMatch(/DO-2026-0042/);
    expect(purgeBlocker(facts({ docs: [{ id: 'd', name: 'DO-PENDING-02', status: 'confirmed' }] }))).toMatch(/DO-PENDING-02/);
    expect(purgeBlocker(facts({ invoices: 1 }))).toMatch(/invoice/);
    expect(purgeBlocker(facts({ postedEntries: 1 }))).toMatch(/ledger/);
  });

  it('knows a placeholder name', () => {
    expect(isPlaceholderDocName('DO-PENDING-02')).toBe(true);
    expect(isPlaceholderDocName(null)).toBe(true);
    expect(isPlaceholderDocName('DO-PENDING-02 (copy)')).toBe(false);
    expect(isPlaceholderDocName('WCT-DO-0009')).toBe(false);
  });
});

// ── the service path, against an in-memory Prisma with just the calls it makes ──
const ORG = '5c700000-0000-4000-8000-5c7000000001';
const RUN = '9931cce0-c309-4e8b-a52c-76543b087eb2';

function world(over: { status?: string; inventoryId?: string | null; docName?: string; docStatus?: string; invoice?: boolean; report?: boolean } = {}) {
  const calls: string[] = [];
  const delivery = {
    id: RUN,
    organizationId: ORG,
    deliveryNumber: 9,
    status: over.status ?? 'cancelled',
    isDraft: false,
    customer: { name: 'TEST SiteClock' },
    items: [{ inventoryId: over.inventoryId ?? null, documentId: over.docName ? 'doc1' : null, deliveryStatus: 'not_delivered', deliveringAt: null, deliveredAt: null, completedAt: null }],
  };
  const prisma: any = {
    delivery: {
      findFirst: async ({ where }: any) => (where.id === RUN && where.organizationId === ORG ? delivery : null),
      delete: (args: any) => (calls.push(`delivery.delete ${args.where.id}`), 'q-delivery'),
    },
    document: {
      findMany: async () => (over.docName ? [{ id: 'doc1', name: over.docName, status: over.docStatus ?? 'unconfirmed' }] : []),
      count: async () => (over.invoice ? 1 : 0),
      deleteMany: (args: any) => (calls.push(`document.deleteMany ${args.where.id.in.join(',')}`), 'q-docs'),
    },
    journalEntry: { count: async () => 0 },
    maintenanceServiceReport: {
      count: async ({ where }: any) => (where.kind ? 0 : over.report ? 1 : 0),
      deleteMany: () => (calls.push('report.deleteMany placeholder'), 'q-reports'),
    },
    deliveryGroupPost: { count: async () => 0 },
    $transaction: async (ops: any[]) => {
      calls.push(`tx(${ops.length})`);
      return ops;
    },
  };
  const touched: string[] = [];
  const siteclock: any = { touch: async (_org: string, id: string) => void touched.push(id) };
  const svc = new DeliveriesService(prisma, undefined as any, undefined as any, undefined as any, undefined as any, undefined, siteclock);
  return { svc, calls, touched };
}

describe('DeliveriesService.purgeCancelled', () => {
  it('deletes the run, its placeholder DO and placeholder report in one transaction, then lets SiteClock follow', async () => {
    const w = world({ docName: 'DO-PENDING-02' });
    const res = await w.svc.purgeCancelled(RUN, ORG);
    expect(w.calls).toEqual(['report.deleteMany placeholder', 'document.deleteMany doc1', 'delivery.delete ' + RUN, 'tx(3)']);
    expect(w.touched).toEqual([RUN]);
    expect(res).toMatchObject({ id: RUN, deleted: true, deliveryNumber: 9, customer: 'TEST SiteClock', placeholderDocs: ['DO-PENDING-02'] });
  });

  it('touches nothing when a guard refuses', async () => {
    for (const over of [{ status: 'scheduled' }, { inventoryId: 'inv1' }, { docName: 'DO-2026-0042' }, { docName: 'DO-PENDING-01', invoice: true }, { report: true }]) {
      const w = world(over);
      await expect(w.svc.purgeCancelled(RUN, ORG)).rejects.toBeInstanceOf(BadRequestException);
      expect(w.calls).toEqual([]);
      expect(w.touched).toEqual([]);
    }
  });

  it('is scoped to the caller org', async () => {
    const w = world();
    await expect(w.svc.purgeCancelled(RUN, 'another-org')).rejects.toBeInstanceOf(NotFoundException);
  });
});
