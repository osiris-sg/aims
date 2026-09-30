import { EventEmitter } from 'events';
import { isOrgFeatureEnabled } from 'src/common/org-features';

/**
 * Delivery group posts (2026-09-30): after a delivery sign-off (full or
 * partial), queue ONE post for the project's WhatsApp group: a caption, the
 * sign-off's photos and the signed DO (rendered later by the sweep). The
 * post-only worker (whatsapp-post-bridge) sends it.
 *
 * Pure helper on purpose: DeliveriesService calls it with its own Prisma, so
 * the deliveries module needs no dependency on the posts module (which pulls in
 * PDF rendering, S3 and public links).
 */
export const DELIVERY_GROUP_POSTS_FLAG = 'enableDeliveryGroupPosts';
export const MAX_POST_PHOTOS = 12;

/** Nudges the render sweep right away instead of waiting for the next minute. */
export const groupPostsKick = new EventEmitter();

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
      },
    });
    if (!run || run.direction !== 'OUTBOUND') return null; // returns are not posted

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
    // installation photos.
    const inventoryIds = items.map((i: any) => i.inventoryId).filter(Boolean);
    const start = await prisma.maintenanceServiceReport.findMany({
      where: {
        deliveryId,
        kind: 'DO_START',
        OR: [...(signedItemIds.length ? [{ deliveryItemId: { in: signedItemIds } }] : []), ...(inventoryIds.length ? [{ deliveryItemId: null, inventoryId: { in: inventoryIds } }] : [])],
      },
      select: { photos: true },
      orderBy: { createdAt: 'asc' },
    });
    const install = await prisma.maintenanceServiceReport.findMany({
      where: { deliveryId, kind: 'DO_INSTALL', signedAt },
      select: { photos: true },
    });
    const allPhotos = [...start, ...install].flatMap((m: any) => m.photos || []).filter((k: string) => k && !k.startsWith('data:'));
    const photoKeys = [...new Set(allPhotos)].slice(0, MAX_POST_PHOTOS) as string[];
    const extraPhotoCount = Math.max(0, new Set(allPhotos).size - photoKeys.length);

    const signer = ack?.signedByName || null;
    const where = [project?.name, run.siteAddress && run.siteAddress !== project?.name ? run.siteAddress : null].filter(Boolean).join(', ');
    const doNames = docs
      .map((d: any) => d.name)
      .filter(Boolean)
      .join(', ');
    const caption = [
      `✅ Delivered: Delivery #${run.deliveryNumber}${where ? `, ${where}` : ''}`,
      `${doNames ? `DO: ${doNames} · ` : ''}signed${signer ? ` by ${signer}` : ''} at ${fmtSgt(signedAt)}`,
      `Trip ${tripNumber}${final ? ' (final)' : ' (partial)'} · ${[...counts].map(([d, q]) => `${q} x ${d}`).join(', ') || 'no items'}`,
      ...(extraPhotoCount ? [`+${extraPhotoCount} more photo${extraPhotoCount === 1 ? '' : 's'} in AIMS`] : []),
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
