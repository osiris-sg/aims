/**
 * Assistant lock on delivered / signed DOs and RDOs (Biofuel, 2026-11-20; flag
 * enableAssistantSignedDocLock, default OFF so every other org is unchanged).
 *
 * With the flag on, the WhatsApp assistant (Operator) may not change a DO/RDO
 * that is delivered, returned, carried by a completed run, or has a signed
 * DO_ACK; nor a completed delivery run. Enforced server-side in two places:
 * the assistant's edit_document tool, and every assistant HTTP write
 * (OperatorDeliveryLockGuard: api_write and any other self-call).
 * Office edits in the portal are not affected.
 */
import { isRdoSigned } from './rdo-free-rows';

export const ASSISTANT_SIGNED_DOC_LOCK_FLAG = 'enableAssistantSignedDocLock';

const DELIVERY_DOC_TYPES = new Set(['DO', 'DELIVERY_ORDER', 'RDO', 'RETURN_DELIVERY_ORDER']);
const DONE_STATUSES = new Set(['delivered_not_installed', 'delivered_installed', 'returned']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDeliveryDocType(type: string | null | undefined): boolean {
  return DELIVERY_DOC_TYPES.has(String(type || '').toUpperCase());
}

type LockPrisma = Parameters<typeof isRdoSigned>[0] & {
  document: { findMany: (args: any) => Promise<Array<{ id: string; name: string | null; type: string; status: string }>> };
};

/** Why this DO/RDO is locked, or null when it may still be edited (or is not a DO/RDO). */
export async function deliveryDocLockReason(
  prisma: Parameters<typeof isRdoSigned>[0],
  organizationId: string,
  doc: { id: string; type: string; status: string | null },
): Promise<string | null> {
  if (!isDeliveryDocType(doc.type)) return null;
  if (DONE_STATUSES.has(String(doc.status))) return String(doc.status);
  if (await isRdoSigned(prisma, organizationId, doc.id)) return 'signed';
  return null;
}

export function assistantLockMessage(name: string | null | undefined): string {
  return `${name || 'This delivery order'} is delivered and signed, so it can't be changed from WhatsApp. Ask the office for a corrected copy.`;
}

/** Every uuid a request names: route params, path segments, and the body's id fields. */
export function uuidsInRequest(req: { params?: any; path?: string; url?: string; body?: any }): string[] {
  const out = new Set<string>();
  const add = (v: any) => {
    if (typeof v === 'string' && UUID_RE.test(v.trim())) out.add(v.trim().toLowerCase());
  };
  for (const v of Object.values(req.params || {})) add(v);
  for (const seg of String(req.path || req.url || '').split('?')[0].split('/')) add(seg);
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  for (const k of ['id', 'documentId', 'deliveryId', 'runId']) add(b[k]);
  for (const k of ['documentIds', 'ids']) if (Array.isArray(b[k])) b[k].forEach(add);
  return [...out];
}

/** The locked DOs/RDOs and completed runs among `ids`, in this org. */
export async function findLockedDeliveryTargets(
  prisma: LockPrisma,
  organizationId: string,
  ids: string[],
): Promise<Array<{ id: string; name: string | null }>> {
  if (!ids.length) return [];
  const locked: Array<{ id: string; name: string | null }> = [];
  const docs = await prisma.document.findMany({
    where: { organizationId, id: { in: ids }, type: { in: [...DELIVERY_DOC_TYPES] } },
    select: { id: true, name: true, type: true, status: true },
  });
  for (const d of docs) if (await deliveryDocLockReason(prisma, organizationId, d)) locked.push({ id: d.id, name: d.name });
  const runs = await prisma.delivery.findMany({
    where: { organizationId, id: { in: ids }, status: 'completed' },
    select: { id: true, status: true },
  });
  for (const r of runs) locked.push({ id: r.id, name: null });
  return locked;
}
