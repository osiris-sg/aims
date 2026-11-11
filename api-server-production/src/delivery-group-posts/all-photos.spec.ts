jest.mock('../common/tenancy/tenant-context', () => ({ runAsOrg: (_org: string, fn: () => unknown) => fn() }));

import { enqueueDeliveryGroupPost, orderPhotosByItem, MAX_POST_PHOTOS_ALL } from './enqueue';
import { DeliveryGroupPostsService, groupPostAlertText } from './delivery-group-posts.service';

/**
 * groupPostAllPhotos (2026-11-11, Biofuel #95: 25 photos, 12 queued, the rest
 * "+13 more in AIMS"): every photo, grouped by item in DO order, up to 60, then
 * "+N more photos in AIMS" with the link. Off: the 12-photo post as before.
 * And the FAILED / stuck alert, DMed through the Cloud API outbox.
 */
const ORG = 'org-1';
const RUN = 'run-95';
const SIGNED_AT = new Date('2026-11-11T08:21:28Z');

// Delivery #95's shape: two unit lines, two free-typed lines, then the run-level installation.
const ITEMS = [
  { id: 'lion-1', description: 'LION375', quantity: 1, assetId: 'a1', inventoryId: 'u1', documentId: 'do-1' },
  { id: 'lion-2', description: 'LION375', quantity: 1, assetId: 'a1', inventoryId: 'u2', documentId: 'do-1' },
  { id: 'gen-1', description: '60kvA GenSet', quantity: 1, assetId: null, inventoryId: null, documentId: 'do-1' },
  { id: 'gen-2', description: '60kvA GenSet', quantity: 1, assetId: null, inventoryId: null, documentId: 'do-1' },
];
const photos = (p: string, n: number) => Array.from({ length: n }, (_, i) => `do-start/${p}-${i + 1}.jpg`);

function fakePrisma(o: { allPhotos?: boolean; startRows: any[]; installPhotos: string[] }) {
  const posts: any[] = [];
  return {
    posts,
    organizationUIConfig: { findUnique: async () => ({ features: { enableDeliveryGroupPosts: true, groupPostAllPhotos: !!o.allPhotos } }) },
    delivery: { findFirst: async () => ({ id: RUN, deliveryNumber: 95, direction: 'OUTBOUND', status: 'completed', projectId: 'p1', customerId: 'c1', siteAddress: null, orderId: null }) },
    maintenanceServiceReport: {
      findFirst: async () => ({ signedAt: SIGNED_AT, signedByName: 'Huangjianling', technicianName: null }),
      findMany: async ({ where, distinct }: any) => {
        if (distinct) return [{ signedAt: SIGNED_AT }];
        if (where.kind === 'DO_START') return o.startRows;
        if (where.kind === 'DO_INSTALL') return [{ kind: 'DO_INSTALL', deliveryItemId: null, inventoryId: null, photos: o.installPhotos }];
        return [];
      },
    },
    project: { findFirst: async () => ({ name: 'Lentor Garden', whatsappGroupId: null, whatsappGroupName: null }) },
    customer: { findFirst: async () => ({ name: 'QJEC-LBC Joint Venture', whatsappGroupId: null, whatsappGroupName: null }) },
    organization: { findUnique: async () => ({ deliveryOpsGroupId: 'ops@g.us', deliveryOpsGroupName: 'Delivery' }) },
    deliveryItem: { findMany: async () => ITEMS },
    document: { findMany: async () => [{ id: 'do-1', name: 'DO202611099' }] },
    inventory: { findMany: async () => [] },
    deliveryGroupPost: {
      create: async ({ data }: any) => {
        posts.push(data);
        return { id: 'post-1', status: data.status };
      },
    },
  };
}

// The start rows arrive by createdAt, which is NOT DO order: gen-2 was started before lion-2.
const START_ROWS = [
  { kind: 'DO_START', deliveryItemId: 'lion-1', inventoryId: 'u1', photos: photos('lion1', 4) },
  { kind: 'DO_START', deliveryItemId: 'gen-2', inventoryId: null, photos: photos('gen2', 5) },
  { kind: 'DO_START', deliveryItemId: null, inventoryId: 'u2', photos: photos('lion2', 5) }, // older row: tied by unit only
  { kind: 'DO_START', deliveryItemId: 'gen-1', inventoryId: null, photos: photos('gen1', 5) },
];
const INSTALL = Array.from({ length: 6 }, (_, i) => `do-install/i-${i + 1}.jpg`);

describe('orderPhotosByItem', () => {
  it('groups by item in DO order (item id, or the unit for older rows), the run-level installation last', () => {
    const out = orderPhotosByItem(ITEMS, [...START_ROWS, { kind: 'DO_INSTALL', deliveryItemId: null, inventoryId: null, photos: INSTALL }]);
    expect(out).toEqual([...photos('lion1', 4), ...photos('lion2', 5), ...photos('gen1', 5), ...photos('gen2', 5), ...INSTALL]);
  });

  it('a return: each item collect photo follows its own start photos; data URLs and repeats dropped', () => {
    const out = orderPhotosByItem(ITEMS.slice(0, 2), [
      { kind: 'DO_START', deliveryItemId: 'lion-2', photos: ['s2.jpg'] },
      { kind: 'DO_ACK', deliveryItemId: 'lion-1', photos: ['c1.jpg', 'data:image/png;base64,x'] },
      { kind: 'DO_START', deliveryItemId: 'lion-1', photos: ['s1.jpg', 's1.jpg'] },
      { kind: 'DO_ACK', deliveryItemId: 'lion-2', photos: ['c2.jpg'] },
    ]);
    expect(out).toEqual(['s1.jpg', 'c1.jpg', 's2.jpg', 'c2.jpg']);
  });
});

describe('enqueueDeliveryGroupPost: groupPostAllPhotos', () => {
  it('off (default): 12 photos and "+13 more photos in AIMS", exactly as before', async () => {
    const prisma = fakePrisma({ startRows: START_ROWS, installPhotos: INSTALL });
    await enqueueDeliveryGroupPost(prisma, ORG, RUN, ITEMS.map((i) => i.id));
    const post = prisma.posts[0];
    expect(post.photoKeys).toHaveLength(12);
    expect(post.photoKeys.slice(0, 5)).toEqual([...photos('lion1', 4), photos('gen2', 1)[0]]); // createdAt order, as before
    expect(post.extraPhotoCount).toBe(13);
    expect(post.caption.split('\n').at(-1)).toBe('+13 more photos in AIMS');
  });

  it('on: all 25 photos grouped by item in DO order, no "more" line', async () => {
    const prisma = fakePrisma({ allPhotos: true, startRows: START_ROWS, installPhotos: INSTALL });
    await enqueueDeliveryGroupPost(prisma, ORG, RUN, ITEMS.map((i) => i.id));
    const post = prisma.posts[0];
    expect(post.photoKeys).toEqual([...photos('lion1', 4), ...photos('lion2', 5), ...photos('gen1', 5), ...photos('gen2', 5), ...INSTALL]);
    expect(post.extraPhotoCount).toBe(0);
    expect(post.caption).not.toMatch(/more photo/);
  });

  it('on, past the ceiling: the first 60, then "+N more photos in AIMS" with the delivery link', async () => {
    const big = [{ kind: 'DO_START', deliveryItemId: 'lion-1', inventoryId: 'u1', photos: photos('many', 70) }];
    const prisma = fakePrisma({ allPhotos: true, startRows: big, installPhotos: INSTALL });
    await enqueueDeliveryGroupPost(prisma, ORG, RUN, ITEMS.map((i) => i.id));
    const post = prisma.posts[0];
    expect(post.photoKeys).toHaveLength(MAX_POST_PHOTOS_ALL);
    expect(post.extraPhotoCount).toBe(16);
    expect(post.caption.split('\n').at(-1)).toMatch(/^\+16 more photos in AIMS: https?:\/\/.+\/portal\/deliveries\/run-95$/);
  });
});

describe('group post alert', () => {
  const now = new Date('2026-11-11T09:30:00Z');

  it('words a FAILED and a stuck post', () => {
    const link = 'https://app.ai-ms.io/portal/deliveries/run-95';
    expect(groupPostAlertText({ status: 'FAILED', attempts: 5, error: 'WhatsApp: part 13/14 timed out', groupName: 'Delivery ', createdAt: SIGNED_AT }, { deliveryNumber: 95 }, link, now)).toBe(
      `AIMS group post FAILED: Delivery #95 to "Delivery" after 5 attempts.\nReason: WhatsApp: part 13/14 timed out\n${link}`,
    );
    expect(groupPostAlertText({ status: 'CLAIMED', groupName: null, createdAt: new Date('2026-11-11T09:10:00Z') }, { deliveryNumber: 102, direction: 'OUTBOUND' }, link, now)).toBe(
      `AIMS group post stuck: Delivery #102 queued 20 min ago, still CLAIMED.\n${link}`,
    );
  });

  function service(rows: any[]) {
    const outbox: any[] = [];
    const svc: any = Object.create(DeliveryGroupPostsService.prototype);
    let findArgs: any = null;
    svc.prisma = {
      deliveryGroupPost: { findMany: async (a: any) => ((findArgs = a), rows) },
      delivery: { findFirst: async () => ({ deliveryNumber: 95, direction: 'OUTBOUND' }) },
      whatsAppOutbox: {
        createMany: async ({ data }: any) => {
          const fresh = data.filter((d: any) => !outbox.some((o) => o.dedupeKey === d.dedupeKey));
          outbox.push(...fresh);
          return { count: fresh.length };
        },
      },
    };
    svc.actionLog = { system: jest.fn() };
    svc.logger = { warn: jest.fn() };
    return { svc: svc as DeliveryGroupPostsService, outbox, findArgs: () => findArgs };
  }

  const failed = { id: 'post-95', organizationId: ORG, deliveryId: RUN, status: 'FAILED', error: 'timed out', groupName: 'Delivery', createdAt: SIGNED_AT, attempts: 5 };

  afterEach(() => delete process.env.GROUP_POST_ALERT_WA);

  it('no recipient set: nothing is queued', async () => {
    const { svc, outbox } = service([failed]);
    expect(await svc.alertFailedOrStuck(now)).toBe(0);
    expect(outbox).toHaveLength(0);
  });

  it('queues one Cloud API DM per post and state, never twice; looks back 24 h, stuck = 15 min', async () => {
    process.env.GROUP_POST_ALERT_WA = '+65 9123 4567';
    const { svc, outbox, findArgs } = service([failed]);
    expect(await svc.alertFailedOrStuck(now)).toBe(1);
    expect(await svc.alertFailedOrStuck(now)).toBe(0);
    expect(outbox).toEqual([
      expect.objectContaining({ to: '6591234567', kind: 'EVENT', userId: 'system:group-post-alert', dedupeKey: 'group-post-alert:post-95:failed:6591234567' }),
    ]);
    const where = findArgs().where;
    expect(+where.createdAt.gte).toBe(+now - 24 * 3600_000);
    expect(+where.OR[1].createdAt.lt).toBe(+now - 15 * 60_000);
  });
});
