import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';

/**
 * SERVER-BUILT STORAGE KEYS (security, 2026-11-24).
 *
 * Every user upload is stored at `org/<orgId>/<folder>/<uuid>.<ext>`:
 *  - the org comes from the caller's session (never the request body),
 *  - the folder from the allow-list below (a client "key"/"folder" is only a
 *    hint that is mapped onto it; anything unknown lands in "misc"),
 *  - the extension and stored Content-Type from the allow-listed MIME type.
 * So a client can never choose (or overwrite) a key, write into another org's
 * prefix, or host an HTML page in the bucket.
 *
 * Keys written before this change keep their old shapes
 * (`maintenance-reports/<org>/...`, `vehicles/<org>/...`, `logos/x.png`...);
 * the validators below accept both.
 */

/** Allowed folders (the part between `org/<orgId>/` and the file name). */
export const UPLOAD_FOLDERS = new Set<string>([
  'logos',
  'stamps',
  'signatures',
  'payment-details',
  'assets',
  'captured-images',
  'msr-photos',
  'msr-annotations',
  'inventory-bind',
  'do-start',
  'do-ack',
  'do-install',
  'do-stamped',
  'delivery-pod',
  'job-fields',
  'custom-fields',
  'maintenance-reports',
  'maintenance-reports/uploads',
  'maintenance-reports/photos',
  'vehicles',
  'vehicles/log',
  'bills',
  'bills/attachments',
  'bills/payments',
  'bills/source',
  'bank-transactions',
  'payments',
  'orders',
  'documents',
  'documents/attachments',
  'documents/signed-do',
  'deliveries',
  'deliveries/signed-do',
  'preview',
  'misc',
]);

/** Sub-folder names a client path may carry after ids (e.g. documents/<id>/signed-do). */
const SUBFOLDERS = new Set(['uploads', 'photos', 'log', 'attachments', 'payments', 'source', 'signed-do']);

/** MIME type → extension. Anything not listed is refused. */
export const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/csv': 'csv',
  'text/plain': 'txt',
};

/** File extension → canonical MIME (for browsers that send an empty or generic type). */
const EXT_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXT).map(([m, e]) => [e, m]).concat([['jpeg', 'image/jpeg']]),
);

/** Served inline (opened in the browser). Everything else is forced to download. */
const INLINE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'video/mp4',
  'video/quicktime',
]);

/** Content-Disposition to store with an object of this type (undefined = inline). */
export function contentDispositionFor(mime: string | undefined | null): string | undefined {
  return INLINE_MIME.has(String(mime || '').toLowerCase()) ? undefined : 'attachment';
}

const ORG_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Map a client folder/key hint ("maintenance-reports/<org>/uploads", "logos/x.png") onto the allow-list. */
export function folderFromHint(hint: unknown, opts: { isKey?: boolean } = {}): string {
  let s = typeof hint === 'string' ? hint.trim().toLowerCase() : '';
  if (!s) return 'misc';
  let parts = s.split('/').filter(Boolean);
  if (opts.isKey) parts = parts.slice(0, -1); // drop the client's file name
  if (parts[0] === 'org') parts = parts.slice(2); // a new-style key sent back: org/<id>/...
  const base = parts[0];
  if (!base || !UPLOAD_FOLDERS.has(base)) return 'misc';
  const sub = [...parts.slice(1)].reverse().find((p) => SUBFOLDERS.has(p));
  if (sub && UPLOAD_FOLDERS.has(`${base}/${sub}`)) return `${base}/${sub}`;
  return base;
}

/** Canonical MIME for an upload, from its declared type or (if generic/empty) its file name. Null = not allowed. */
export function allowedMime(declared: string | undefined | null, fileName?: string | null): string | null {
  const m = String(declared || '').toLowerCase().split(';')[0].trim();
  if (m === 'image/jpg' || m === 'image/pjpeg') return 'image/jpeg';
  if (MIME_EXT[m]) return m;
  if (!m || m === 'application/octet-stream' || m === 'binary/octet-stream') {
    const ext = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    if (ext && EXT_MIME[ext]) return EXT_MIME[ext];
  }
  return null;
}

/** Do the first bytes match the declared image/PDF type? (Office/text types are not sniffed.) */
export function bytesMatchMime(buf: Buffer | Uint8Array | undefined, mime: string): boolean {
  if (!buf || !buf.length) return false;
  const b = Buffer.from(buf.buffer ?? buf, (buf as any).byteOffset ?? 0, buf.length);
  const hex = (n: number) => b.subarray(0, n).toString('hex');
  switch (mime) {
    case 'image/png':
      return hex(8) === '89504e470d0a1a0a';
    case 'image/jpeg':
      return hex(3) === 'ffd8ff';
    case 'image/gif':
      return b.subarray(0, 4).toString('latin1') === 'GIF8';
    case 'image/webp':
      return b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
    case 'image/heic':
    case 'image/heif':
      return b.subarray(4, 8).toString('latin1') === 'ftyp';
    case 'application/pdf':
      return b.subarray(0, 1024).toString('latin1').includes('%PDF');
    case 'image/svg+xml':
      return !/<script|\son[a-z]+\s*=|javascript:/i.test(b.toString('utf8'));
    default:
      return true;
  }
}

/** `org/<orgId>/<folder>/<uuid>.<ext>`: the only shape a new user upload can have. */
export function buildOrgKey(organizationId: string, folder: string, mime: string): string {
  if (!ORG_ID_RE.test(String(organizationId || ''))) throw new BadRequestException('No organisation for this upload');
  if (!UPLOAD_FOLDERS.has(folder)) throw new BadRequestException('Unknown upload folder');
  const ext = MIME_EXT[mime];
  if (!ext) throw new BadRequestException('That file type cannot be uploaded');
  return `org/${organizationId}/${folder}/${randomUUID()}.${ext}`;
}

/** The org a key belongs to by its shape (new `org/<id>/` keys and legacy org-prefixed folders), else null. */
export function orgOfKey(key: string): string | null {
  const p = String(key || '').split('/');
  if (p[0] === 'org' && p[1]) return p[1];
  if (['maintenance-reports', 'vehicles', 'shipments', 'delivery-pod', 'submit-uploads', 'leads', 'payables', 'project-costs', 'projects', 'email-ingest', 'extracted-uploads', 'supplier-uploads', 'whatsapp', 'whatsapp-previews', 'delivery-posts'].includes(p[0]) && p[1] && ORG_ID_RE.test(p[1]) && p.length > 2) {
    return p[1];
  }
  return null;
}

/**
 * Is `key` a file of `organizationId` in `folder`? Accepts the new shape
 * (`org/<org>/<folder>/...`) and the legacy one (`<folder>/<org>/...`).
 */
export function isOrgFolderKey(key: unknown, organizationId: string, folder: string): boolean {
  if (typeof key !== 'string' || !key || key.includes('..') || key.length > 300) return false;
  return key.startsWith(`org/${organizationId}/${folder}/`) || key.startsWith(`${folder}/${organizationId}/`);
}
