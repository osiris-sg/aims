/**
 * Job photos from SiteClock (WCT 2026-11-02). Workers take photos on a job in
 * the SiteClock app; for an AIMS job (externalRef aims-delivery:<deliveryId>)
 * SiteClock sends each one to AIMS, which keeps it: the photos show on the job
 * (delivery) and on its order, and a Signed DO / Stamped DO photo is evidence
 * for the job's DO verification. Pure helpers, no I/O.
 */
import { createHash, randomBytes } from 'crypto';

export const JOB_PHOTO_TAGS = ['SIGNED_DO', 'STAMPED_DO', 'SERVICE_REPORT', 'SITE', 'OTHER'] as const;
export type JobPhotoTag = (typeof JOB_PHOTO_TAGS)[number];
export const isJobPhotoTag = (v: unknown): v is JobPhotoTag => typeof v === 'string' && (JOB_PHOTO_TAGS as readonly string[]).includes(v);

export const JOB_PHOTO_TAG_LABEL: Record<JobPhotoTag, string> = {
  SIGNED_DO: 'Signed DO',
  STAMPED_DO: 'Stamped DO',
  SERVICE_REPORT: 'Service report',
  SITE: 'Site',
  OTHER: 'Other',
};

/** Tags that are evidence for the job's DO (verification + DO attachment). */
export const isDoEvidenceTag = (tag: string) => tag === 'SIGNED_DO' || tag === 'STAMPED_DO';

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_NOTE = 300;
export const URL_TTL_SEC = 15 * 60;
/** Long edge of the stored photo, and the thumbnail's width. */
export const FULL_EDGE = 2560;
export const THUMB_WIDTH = 400;

/** The delivery a SiteClock externalRef names: "aims-delivery:<uuid>" or, for a job re-created after a cancel, "aims-delivery:<uuid>:<n>". */
export function deliveryIdFromRef(ref: unknown): string | null {
  const m = /^aims-delivery:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::\d{1,4})?$/i.exec(String(ref ?? '').trim());
  return m ? m[1].toLowerCase() : null;
}

// ── inbound key ─────────────────────────────────────────────────────────────

/** SiteClock's key for calling AIMS. A different prefix from the /v1 API keys (aims_…), so neither ever unlocks the other. */
export const INBOUND_KEY_PREFIX = 'aims_sck_';

export function newInboundKey(): string {
  return INBOUND_KEY_PREFIX + randomBytes(32).toString('base64url');
}

export const hashInboundKey = (plaintext: string) => createHash('sha256').update(plaintext).digest('hex');

/** The bearer token of a request, or '' (Authorization: Bearer <key>). */
export function bearerOf(authorization: unknown): string {
  const a = String(authorization ?? '').trim();
  return a.toLowerCase().startsWith('bearer ') ? a.slice(7).trim() : '';
}

// ── upload fields ───────────────────────────────────────────────────────────

export interface PhotoFields {
  externalRef: string;
  deliveryId: string;
  siteclockPhotoId: string;
  tag: JobPhotoTag;
  note: string | null;
  takenAt: Date | null;
  workerSiteclockUserId: string | null;
  workerName: string | null;
}

/** The multipart fields checked; a string is the 400 message. The Idempotency-Key header must match siteclockPhotoId when both are sent (siteclockPhotoId is the source of truth). */
export function parsePhotoFields(body: Record<string, any>, idempotencyKey?: unknown): PhotoFields | string {
  const b = body || {};
  const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
  const externalRef = str(b.externalRef);
  const deliveryId = deliveryIdFromRef(externalRef);
  if (!deliveryId) return 'externalRef must be "aims-delivery:<deliveryId>"';
  const siteclockPhotoId = str(b.siteclockPhotoId) || str(idempotencyKey);
  if (!siteclockPhotoId) return 'siteclockPhotoId is required';
  if (siteclockPhotoId.length > 100) return 'siteclockPhotoId is too long (100 max)';
  const header = str(idempotencyKey);
  if (header && str(b.siteclockPhotoId) && header !== siteclockPhotoId) return 'Idempotency-Key does not match siteclockPhotoId';
  const tag = str(b.tag).toUpperCase();
  if (!isJobPhotoTag(tag)) return `tag must be one of ${JOB_PHOTO_TAGS.join(', ')}`;
  const note = str(b.note);
  if (note.length > MAX_NOTE) return `note is too long (${MAX_NOTE} max)`;
  let takenAt: Date | null = null;
  if (str(b.takenAt)) {
    takenAt = new Date(str(b.takenAt));
    if (isNaN(takenAt.getTime())) return 'takenAt must be an ISO date-time';
  }
  return {
    externalRef,
    deliveryId,
    siteclockPhotoId,
    tag,
    note: note || null,
    takenAt,
    workerSiteclockUserId: str(b.workerSiteclockUserId).slice(0, 100) || null,
    workerName: str(b.workerName).slice(0, 120) || null,
  };
}

/** Where a job photo's files live in S3. Outside Render (dev, scripts) under dev/, since dev and prod share the bucket. */
export function photoKeys(organizationId: string, deliveryId: string, id: string, onRender = !!process.env.RENDER) {
  const base = `${onRender ? '' : 'dev/'}job-photos/${organizationId}/${deliveryId}/${id}`;
  return { fileKey: `${base}.jpg`, thumbKey: `${base}_thumb.jpg` };
}

/** Download file name: "Stamped DO - DO202611009 - 2.jpg". */
export function downloadName(tag: string, doNumber: string | null | undefined, n?: number): string {
  const label = isJobPhotoTag(tag) ? JOB_PHOTO_TAG_LABEL[tag] : 'Photo';
  return (
    [label, doNumber || null, n && n > 1 ? String(n) : null]
      .filter(Boolean)
      .join(' - ')
      .replace(/[^\w .-]/g, '') + '.jpg'
  );
}

/**
 * What a new Signed DO / Stamped DO photo does to the job's verification:
 * a rejected job goes back to pending (like "Send new evidence"); otherwise
 * nothing changes (a pending one just gains the evidence, a signed or verified
 * one only shows it, an unfinished one keeps it for when it is finished).
 */
export function verificationAfterDoPhoto(run: { status: string; verificationState: string | null }): 'pending' | null {
  return run.status === 'completed' && run.verificationState === 'rejected' ? 'pending' : null;
}
