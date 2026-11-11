import { EventEmitter } from 'events';
import { isOrgFeatureEnabled } from 'src/common/org-features';
import { runNoun } from '../deliveries/job-wording';

/**
 * Delivery group posts (2026-09-30): after a delivery sign-off (full or
 * partial), queue ONE post for the project's WhatsApp group: a caption, the
 * sign-off's photos and the signed DO (rendered later by the sweep). The
 * post-only worker (whatsapp-post-bridge) sends it.
 *
 * RETURN runs (2026-11-02) post the same way at their one sign-off
 * (finalizeReturn): the signed RDO, the collection photos and a "Returned: …"
 * caption. Same group order, idempotency and SKIPPED rule as a delivery.
 *
 * Pure helper on purpose: DeliveriesService calls it with its own Prisma, so
 * the deliveries module needs no dependency on the posts module (which pulls in
 * PDF rendering, S3 and public links).
 */
export const DELIVERY_GROUP_POSTS_FLAG = 'enableDeliveryGroupPosts';
export const MAX_POST_PHOTOS = 12;
// Org setting (2026-11-11, Biofuel): post EVERY photo of the sign-off, grouped
// by item in DO order, up to a safety ceiling; past it "+N more photos in AIMS"
// with the delivery's link. Off: the 12-photo post exactly as before.
export const GROUP_POST_ALL_PHOTOS_FLAG = 'groupPostAllPhotos';
export const MAX_POST_PHOTOS_ALL = 60;

type ProofRow = { kind?: string; deliveryItemId?: string | null; inventoryId?: string | null; photos?: string[] | null };

/**
 * The sign-off's photos grouped by item, in DO order (the items' sortOrder):
 * each item's start photos, then its own collect / acknowledgement photos;
 * proof tied to no item (the run-level installation) comes last. Rows keep
 * their own order within an item. Data URLs and repeats are dropped.
 */
export function orderPhotosByItem(items: Array<{ id: string; inventoryId?: string | null }>, rows: ProofRow[]): string[] {
  const rank = new Map<string, number>();
  items.forEach((it, i) => {
    rank.set(`item:${it.id}`, i);
    if (it.inventoryId) rank.set(`unit:${it.inventoryId}`, i);
  });
  const rankOf = (r: ProofRow) =>
    (r.deliveryItemId != null ? rank.get(`item:${r.deliveryItemId}`) : undefined) ??
    (r.inventoryId != null ? rank.get(`unit:${r.inventoryId}`) : undefined) ??
    Number.MAX_SAFE_INTEGER;
  const startFirst = (r: ProofRow) => (r.kind === 'DO_START' ? 0 : 1);
  const sorted = rows.map((r, i) => ({ r, i })).sort((a, b) => rankOf(a.r) - rankOf(b.r) || startFirst(a.r) - startFirst(b.r) || a.i - b.i);
  const keys = sorted.flatMap(({ r }) => r.photos || []).filter((k) => k && !k.startsWith('data:'));
  return [...new Set(keys)];
}

/** Nudges the render sweep right away instead of waiting for the next minute. */
export const groupPostsKick = new EventEmitter();

const portalUrl = (p: string) => `${(process.env.PORTAL_URL || process.env.FRONTEND_URL || 'https://app.ai-ms.io').replace(/\/+$/, '')}${p}`;

const fmtSgt = (d: Date) => d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Singapore' });

/**
 * Queue the post for the sign-off that just happened on `deliveryId`.
 * `signedItemIds` = the DeliveryItems this sign-off covered. Never throws: a
 * failure here must never fail the customer's signature.
 */
export async function enqueueDeliveryGroupPost(
  prisma: any,
  organizationId: string,
  deliveryId: string,
  signedItemIds: string[],
  logger?: { warn: (m: string) => void; log?: (m: string) => void },
): Promise<{ id: string; status: string } | null> {
  try {
    if (!(await isOrgFeatureEnabled(prisma, organizationId, DELIVERY_GROUP_POSTS_FLAG))) return null;
    const run = await prisma.delivery.findFirst({
      where: { id: deliveryId, organizationId },
      select: {
        id: true,
        deliveryNumber: true,
        direction: true,
        status: true,
        projectId: true,
        customerId: true,
        siteAddress: true,
        // WCT order job: the caption says "Job #12" (deliveries/job-wording.ts).
        orderId: true,
      },
    });
    if (!run || (run.direction !== 'OUTBOUND' && run.direction !== 'RETURN')) return null;
    const isReturn = run.direction === 'RETURN';

    // This sign-off's timestamp: the proof rows it just stamped.
    const ack = await prisma.maintenanceServiceReport.findFirst({
      where: {
        deliveryId,
        kind: { in: ['DO_ACK', 'DO_INSTALL'] },
        signedAt: { not: null },
        ...(signedItemIds.length ? { OR: [{ deliveryItemId: { in: signedItemIds } }, { kind: 'DO_INSTALL', deliveryItemId: null }] } : {}),
      },
      orderBy: { signedAt: 'desc' },
      select: { signedAt: true, signedByName: true, technicianName: true },
    });
    const signedAt: Date = ack?.signedAt ?? new Date();
    const signOffs = await prisma.maintenanceServiceReport.findMany({
      where: { deliveryId, kind: { in: ['DO_ACK', 'DO_INSTALL'] }, signedAt: { not: null, lte: signedAt } },
      select: { signedAt: true },
      distinct: ['signedAt'],
    });
    const tripNumber = Math.max(1, signOffs.length);
    const final = run.status === 'completed';

    // Where it goes: Project, then Customer, then the org's ops group.
    const project = run.projectId ? await prisma.project.findFirst({ where: { id: run.projectId, organizationId }, select: { name: true, whatsappGroupId: true, whatsappGroupName: true } }) : null;
    const customer = run.customerId ? await prisma.customer.findFirst({ where: { id: run.customerId, organizationId }, select: { name: true, whatsappGroupId: true, whatsappGroupName: true } }) : null;
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { deliveryOpsGroupId: true, deliveryOpsGroupName: true },
    });
    const group = project?.whatsappGroupId
      ? { id: project.whatsappGroupId, name: project.whatsappGroupName, source: 'project' }
      : customer?.whatsappGroupId
        ? { id: customer.whatsappGroupId, name: customer.whatsappGroupName, source: 'customer' }
        : org?.deliveryOpsGroupId
          ? { id: org.deliveryOpsGroupId, name: org.deliveryOpsGroupName, source: 'ops' }
          : null;

    // What was signed for, and its DO(s).
    const items = await prisma.deliveryItem.findMany({
      where: { deliveryId, ...(signedItemIds.length ? { id: { in: signedItemIds } } : {}) },
      select: { id: true, description: true, quantity: true, assetId: true, inventoryId: true, documentId: true },
      orderBy: { sortOrder: 'asc' },
    });
    const counts = new Map<string, number>();
    for (const it of items) {
      const k = it.description || 'item';
      counts.set(k, (counts.get(k) || 0) + (it.assetId ? 1 : it.quantity || 1));
    }
    const documentIds = [...new Set(items.map((i: any) => i.documentId).filter(Boolean))] as string[];
    const docs = documentIds.length ? await prisma.document.findMany({ where: { id: { in: documentIds }, organizationId }, select: { id: true, name: true } }) : [];

    // Photos of THIS sign-off: condition photos of the signed units (by item,
    // or by unit for older rows without an item link) + this sign-off's
    // installation photos. A return has no install step: its photos are the
    // collection photos, taken at the start of the return and/or when each unit
    // was collected (the per-unit DO_ACK).
    const inventoryIds = items.map((i: any) => i.inventoryId).filter(Boolean);
    const ofSignedUnits = [
      ...(signedItemIds.length ? [{ deliveryItemId: { in: signedItemIds } }] : []),
      ...(inventoryIds.length ? [{ deliveryItemId: null, inventoryId: { in: inventoryIds } }] : []),
    ];
    const proofSelect = { kind: true, deliveryItemId: true, inventoryId: true, photos: true };
    const start = await prisma.maintenanceServiceReport.findMany({
      where: { deliveryId, kind: 'DO_START', OR: ofSignedUnits },
      select: proofSelect,
      orderBy: { createdAt: 'asc' },
    });
    const after = isReturn
      ? await prisma.maintenanceServiceReport.findMany({
          where: { deliveryId, kind: 'DO_ACK', OR: ofSignedUnits },
          select: proofSelect,
          orderBy: { createdAt: 'asc' },
        })
      : await prisma.maintenanceServiceReport.findMany({
          where: { deliveryId, kind: 'DO_INSTALL', signedAt },
          select: proofSelect,
        });
    const allPhotosOn = await isOrgFeatureEnabled(prisma, organizationId, GROUP_POST_ALL_PHOTOS_FLAG).catch(() => false);
    const allPhotos: string[] = allPhotosOn
      ? orderPhotosByItem(items, [...start, ...after])
      : [...new Set([...start, ...after].flatMap((m: any) => m.photos || []).filter((k: string) => k && !k.startsWith('data:')))] as string[];
    const photoKeys = allPhotos.slice(0, allPhotosOn ? MAX_POST_PHOTOS_ALL : MAX_POST_PHOTOS);
    const extraPhotoCount = Math.max(0, allPhotos.length - photoKeys.length);

    const signer = ack?.signedByName || null;
    const doNames = docs
      .map((d: any) => d.name)
      .filter(Boolean)
      .join(', ');
    // Partial trip: how much of the run is still to deliver (a catalog line is
    // one row per unit; a free-typed line carries its own quantity).
    const owed = final
      ? 0
      : (
          await prisma.deliveryItem.findMany({
            where: { deliveryId, deliveryStatus: { not: 'completed' } },
            select: { assetId: true, quantity: true },
          })
        ).reduce((n: number, i: any) => n + (i.assetId ? 1 : i.quantity || 1), 0);
    // Format (2026-10-02):
    //   Delivery #69, ZZ Customer (ZZTestProject)
    //
    //   DO: DO202610078 · signed by elroy at 2 Oct, 2:46 pm
    //   Trip 1 (final) · 1 x ZZTEST Asset
    // Who: the customer always, the project in brackets (2026-11-02), e.g.
    // "Return #88, Singapore Sailing Port Pte. Ltd. (Nil)".
    const who = customer?.name ? `${customer.name}${project?.name ? ` (${project.name})` : ''}` : project?.name;
    const noun = runNoun(run);
    const head = [`${isReturn ? 'Return' : noun} #${run.deliveryNumber}`, who].filter(Boolean).join(', ');
    const what = [...counts].map(([d, q]) => `${q} x ${d}`).join(', ');
    let body: string[];
    if (isReturn) {
      // Return (2026-11-02): one signature at the end, always the last trip.
      //   Return #88, Singapore Sailing Port Pte. Ltd. (Nil)
      //
      //   RDO: RDO202611-001
      //   Returned: 2 x FIREFLY 4200 (AIS2026016, AIS2026019), signed by Azad at 2 Nov, 6:02 pm
      const units = await skusOf(prisma, organizationId, inventoryIds);
      body = [
        ...(doNames ? [`RDO: ${doNames}`] : []),
        `Returned: ${what || 'no items'}${units.length ? ` (${units.join(', ')})` : ''}, signed${signer ? ` by ${signer}` : ''} at ${fmtSgt(signedAt)}`,
      ];
    } else {
      body = [
        `${doNames ? `DO: ${doNames} · signed` : 'Signed'}${signer ? ` by ${signer}` : ''} at ${fmtSgt(signedAt)}`,
        `Trip ${tripNumber} (${final ? 'final' : `partial: ${owed} item${owed === 1 ? '' : 's'} still to ${noun === 'Job' ? 'do' : 'deliver'}`}) · ${what || 'no items'}`,
      ];
    }
    const caption = [
      head,
      '',
      ...body,
      ...(extraPhotoCount
        ? [`+${extraPhotoCount} more photo${extraPhotoCount === 1 ? '' : 's'} in AIMS${allPhotosOn ? `: ${portalUrl(`/portal/deliveries/${deliveryId}`)}` : ''}`]
        : []),
    ].join('\n');

    try {
      const row = await prisma.deliveryGroupPost.create({
        data: {
          organizationId,
          deliveryId,
          signedAt,
          status: group ? 'PENDING' : 'SKIPPED',
          final,
          tripNumber,
          groupId: group?.id ?? null,
          groupName: group?.name ?? null,
          groupSource: group?.source ?? null,
          caption,
          photoKeys,
          extraPhotoCount,
          documentIds,
          pdfKeys: [],
          messageIds: [],
          ...(group ? {} : { error: 'No WhatsApp group on the project, the customer or the organization' }),
        },
        select: { id: true, status: true },
      });
      if (row.status === 'PENDING') groupPostsKick.emit('kick');
      return row;
    } catch (e: any) {
      // (deliveryId, signedAt) is unique: this sign-off is already queued.
      if (e?.code === 'P2002') return null;
      throw e;
    }
  } catch (e: any) {
    logger?.warn(`delivery group post not queued for ${deliveryId}: ${e?.message}`);
    return null;
  }
}

/** Unit tags (Inventory.sku) of the signed units, in the order given. */
async function skusOf(prisma: any, organizationId: string, inventoryIds: string[]): Promise<string[]> {
  if (!inventoryIds.length) return [];
  const rows = await prisma.inventory.findMany({ where: { id: { in: inventoryIds }, organizationId }, select: { id: true, sku: true } });
  const byId = new Map<string, string | null>(rows.map((r: any) => [r.id, r.sku]));
  return inventoryIds.map((id) => byId.get(id)).filter((v): v is string => !!v);
}
