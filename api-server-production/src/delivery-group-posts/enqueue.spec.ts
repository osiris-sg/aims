import { enqueueDeliveryGroupPost } from './enqueue';

/**
 * Group posts for RETURN runs (2026-11-02): same flag, group order, idempotency
 * and SKIPPED rule as a delivery; return wording and the collection photos.
 * A small in-memory Prisma answers exactly the reads enqueue makes.
 */
const ORG = 'org-1';
const RUN = 'run-88';
const SIGNED_AT = new Date('2026-11-02T10:02:23Z'); // 6:02 pm in Singapore

type Fixture = {
  flag?: boolean;
  direction?: 'OUTBOUND' | 'RETURN';
  orderId?: string | null;
  projectGroup?: string | null;
  customerGroup?: string | null;
  opsGroup?: string | null;
};

function fakePrisma(f: Fixture = {}) {
  const posts: any[] = [];
  const reports = [
    { kind: 'DO_START', deliveryItemId: 'i1', photos: ['start-1.jpg', 'start-2.jpg'], signedAt: null, createdAt: 1 },
    { kind: 'DO_START', deliveryItemId: 'i2', photos: ['start-3.jpg'], signedAt: null, createdAt: 2 },
    { kind: 'DO_ACK', deliveryItemId: 'i1', photos: ['collect-1.jpg'], signedAt: SIGNED_AT, signedByName: 'Azad', createdAt: 3 },
    { kind: 'DO_ACK', deliveryItemId: 'i2', photos: [], signedAt: SIGNED_AT, signedByName: 'Azad', createdAt: 4 },
    { kind: 'DO_INSTALL', deliveryItemId: 'i1', photos: ['install-1.jpg'], signedAt: SIGNED_AT, createdAt: 5 },
  ];
  const kindOk = (r: any, kind: any) => (typeof kind === 'string' ? r.kind === kind : kind?.in ? kind.in.includes(r.kind) : true);
  const signedOk = (r: any, s: any) => (s === undefined ? true : s instanceof Date ? +r.signedAt === +s : s?.not === null ? r.signedAt != null : true);
  const match = (where: any) => reports.filter((r) => kindOk(r, where.kind) && signedOk(r, where.signedAt));
  return {
    posts,
    organizationUIConfig: { findUnique: async () => ({ features: { enableDeliveryGroupPosts: f.flag !== false } }) },
    delivery: {
      findFirst: async () => ({ id: RUN, deliveryNumber: 88, direction: f.direction ?? 'RETURN', status: 'completed', projectId: 'p1', customerId: 'c1', siteAddress: null, orderId: f.orderId ?? null }),
    },
    maintenanceServiceReport: {
      findFirst: async ({ where }: any) => match(where).sort((a, b) => +b.signedAt - +a.signedAt)[0] ?? null,
      findMany: async ({ where, distinct }: any) => {
        const rows = match(where);
        if (distinct) return [...new Map(rows.map((r) => [+r.signedAt, r])).values()];
        return rows.sort((a, b) => a.createdAt - b.createdAt);
      },
    },
    project: { findFirst: async () => ({ name: 'Nil', whatsappGroupId: f.projectGroup ?? null, whatsappGroupName: f.projectGroup ? 'Project group' : null }) },
    customer: { findFirst: async () => ({ name: 'Singapore Sailing Port', whatsappGroupId: f.customerGroup ?? null, whatsappGroupName: f.customerGroup ? 'Customer group' : null }) },
    organization: { findUnique: async () => ({ deliveryOpsGroupId: f.opsGroup ?? null, deliveryOpsGroupName: f.opsGroup ? 'Ops group' : null }) },
    deliveryItem: {
      findMany: async () => [
        { id: 'i1', description: 'FIREFLY 4200', quantity: 1, assetId: 'a1', inventoryId: 'u16', documentId: 'rdo-1' },
        { id: 'i2', description: 'FIREFLY 4200', quantity: 1, assetId: 'a1', inventoryId: 'u19', documentId: 'rdo-1' },
      ],
    },
    document: { findMany: async () => [{ id: 'rdo-1', name: 'RDO202611-001' }] },
    inventory: { findMany: async () => [{ id: 'u19', sku: 'AIS2026019' }, { id: 'u16', sku: 'AIS2026016' }] },
    deliveryGroupPost: {
      create: async ({ data }: any) => {
        if (posts.some((p) => p.deliveryId === data.deliveryId && +p.signedAt === +data.signedAt)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        const row = { id: `post-${posts.length + 1}`, ...data };
        posts.push(row);
        return { id: row.id, status: row.status };
      },
    },
  };
}

describe('enqueueDeliveryGroupPost: return runs', () => {
  it('queues ONE post per return sign-off (a repeat is a no-op)', async () => {
    const prisma = fakePrisma({ customerGroup: 'c@g.us' });
    const first = await enqueueDeliveryGroupPost(prisma, ORG, RUN, ['i1', 'i2']);
    const again = await enqueueDeliveryGroupPost(prisma, ORG, RUN, ['i1', 'i2']);
    expect(first?.status).toBe('PENDING');
    expect(again).toBeNull();
    expect(prisma.posts).toHaveLength(1);
    expect(prisma.posts[0]).toMatchObject({ final: true, tripNumber: 1, documentIds: ['rdo-1'], signedAt: SIGNED_AT });
  });

  it('says Returned, names the RDO, the units and the signer, never "delivered"', async () => {
    const prisma = fakePrisma({ customerGroup: 'c@g.us' });
    await enqueueDeliveryGroupPost(prisma, ORG, RUN, ['i1', 'i2']);
    const { caption } = prisma.posts[0];
    expect(caption).toBe(
      ['Return #88, Singapore Sailing Port (Nil)', '', 'RDO: RDO202611-001', 'Returned: 2 x FIREFLY 4200 (AIS2026016, AIS2026019), signed by Azad at 2 Nov, 6:02 pm'].join('\n'),
    );
    expect(caption).not.toMatch(/deliver/i);
    expect(caption).not.toMatch(/Trip/);
  });

  it('carries the collection photos (start + per-unit collect), not install photos', async () => {
    const prisma = fakePrisma({ customerGroup: 'c@g.us' });
    await enqueueDeliveryGroupPost(prisma, ORG, RUN, ['i1', 'i2']);
    expect(prisma.posts[0].photoKeys).toEqual(['start-1.jpg', 'start-2.jpg', 'start-3.jpg', 'collect-1.jpg']);
  });

  it.each([
    [{ projectGroup: 'p@g.us', customerGroup: 'c@g.us', opsGroup: 'o@g.us' }, 'p@g.us', 'project'],
    [{ customerGroup: 'c@g.us', opsGroup: 'o@g.us' }, 'c@g.us', 'customer'],
    [{ opsGroup: 'o@g.us' }, 'o@g.us', 'ops'],
  ])('resolves the group like a delivery: project, then customer, then ops (%#)', async (f, id, source) => {
    const prisma = fakePrisma(f);
    await enqueueDeliveryGroupPost(prisma, ORG, RUN, ['i1', 'i2']);
    expect(prisma.posts[0]).toMatchObject({ status: 'PENDING', groupId: id, groupSource: source });
  });

  it('no group anywhere: queued as SKIPPED with the reason (retry once a group is picked)', async () => {
    const prisma = fakePrisma({});
    const row = await enqueueDeliveryGroupPost(prisma, ORG, RUN, ['i1', 'i2']);
    expect(row?.status).toBe('SKIPPED');
    expect(prisma.posts[0].error).toMatch(/No WhatsApp group/);
  });

  it('flag off: nothing is queued', async () => {
    const prisma = fakePrisma({ flag: false, customerGroup: 'c@g.us' });
    expect(await enqueueDeliveryGroupPost(prisma, ORG, RUN, ['i1', 'i2'])).toBeNull();
    expect(prisma.posts).toHaveLength(0);
  });

  it('the heading names the customer, with the project in brackets when there is one', async () => {
    const noProject = fakePrisma({ customerGroup: 'c@g.us' });
    noProject.project.findFirst = async () => null as any;
    await enqueueDeliveryGroupPost(noProject, ORG, RUN, ['i1', 'i2']);
    expect(noProject.posts[0].caption.split('\n')[0]).toBe('Return #88, Singapore Sailing Port');
    const noCustomer = fakePrisma({ projectGroup: 'p@g.us' });
    noCustomer.customer.findFirst = async () => null as any;
    await enqueueDeliveryGroupPost(noCustomer, ORG, RUN, ['i1', 'i2']);
    expect(noCustomer.posts[0].caption.split('\n')[0]).toBe('Return #88, Nil');
  });

  it('a delivery keeps its own wording and its installation photos', async () => {
    const prisma = fakePrisma({ direction: 'OUTBOUND', customerGroup: 'c@g.us' });
    await enqueueDeliveryGroupPost(prisma, ORG, RUN, ['i1', 'i2']);
    const post = prisma.posts[0];
    expect(post.caption).toMatch(/^Delivery #88, Singapore Sailing Port \(Nil\)\n\nDO: RDO202611-001 · signed by Azad at 2 Nov, 6:02 pm\nTrip 1 \(final\) · 2 x FIREFLY 4200$/);
    expect(post.photoKeys).toEqual(['start-1.jpg', 'start-2.jpg', 'start-3.jpg', 'install-1.jpg']);
  });

  it('a job of a WCT order says "Job #", the rest of the caption unchanged', async () => {
    const prisma = fakePrisma({ direction: 'OUTBOUND', customerGroup: 'c@g.us', orderId: 'o1' });
    await enqueueDeliveryGroupPost(prisma, ORG, RUN, ['i1', 'i2']);
    expect(prisma.posts[0].caption).toMatch(/^Job #88, Singapore Sailing Port \(Nil\)\n\nDO: RDO202611-001 · signed by Azad at 2 Nov, 6:02 pm\nTrip 1 \(final\) · 2 x FIREFLY 4200$/);
  });
});
