import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { from, Observable, switchMap } from 'rxjs';

/**
 * SERVER-SIDE SIGNING FOR RENDERERS AND TOKEN PAGES (security phase 3, 2026-11-24).
 *
 * The bucket goes private in phase 4, so nothing may load a file by its public
 * URL any more:
 *  - signBucketUrlsInHtml(): every public bucket URL inside rendered HTML (PDFs
 *    via Puppeteer, report / document previews) becomes a 1 h presigned URL;
 *  - SignedFileUrlsInterceptor: public token pages (no Clerk session) get a
 *    `fileUrls` map { stored value → presigned URL } next to their payload, and
 *    the portal's fileSrc() uses it. The stored values themselves are untouched
 *    (so nothing writes a short-lived URL back to the database).
 * Only callers that already proved access to the record (its org, or a valid
 * public token) reach these.
 */

const BUCKET = () => process.env.RESOURCE_BUCKET || 'aims-osiris';
let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: process.env.AWS_REGION || 'ap-southeast-1',
      ...(process.env.AWS_ACCESS_KEY_ID
        ? { credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '' } }
        : {}),
    });
  }
  return client;
}

/** Test seam. */
export function __setPresigner(fn: ((key: string, ttl: number) => Promise<string>) | null) {
  presignOverride = fn;
}
let presignOverride: ((key: string, ttl: number) => Promise<string>) | null = null;

export async function presignKey(key: string, ttl = 3600): Promise<string> {
  if (presignOverride) return presignOverride(key, ttl);
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET(), Key: key }), { expiresIn: ttl });
}

/** Public bucket URL (virtual-hosted or path style), not already signed. Group 1 = the key. */
const bucketUrlRe = () =>
  new RegExp(
    `https?://(?:${BUCKET()}\\.s3(?:[.-][a-z0-9-]+)?\\.amazonaws\\.com/|s3(?:[.-][a-z0-9-]+)?\\.amazonaws\\.com/${BUCKET()}/)([^\\s"'<>?#)\\\\]+)(?![^\\s"'<>)]*X-Amz-Signature)`,
    'gi',
  );

function keyFromPath(p: string): string | null {
  let k = p.replace(/&amp;/g, '&');
  try {
    k = decodeURIComponent(k);
  } catch {
    /* keep */
  }
  return k && !k.includes('..') ? k : null;
}

/** Replace every public bucket URL in an HTML string with a presigned one. */
export async function signBucketUrlsInHtml(html: string, ttl = 3600): Promise<string> {
  if (!html || !html.includes('amazonaws.com')) return html;
  const re = bucketUrlRe();
  const found = new Map<string, string>(); // full match → key
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].includes('?')) continue;
    const k = keyFromPath(m[1]);
    if (k) found.set(m[0], k);
  }
  if (!found.size) return html;
  const signed = new Map<string, string>();
  await Promise.all(
    [...found].map(async ([full, key]) => {
      try {
        signed.set(full, (await presignKey(key, ttl)).replace(/&/g, '&amp;'));
      } catch {
        /* leave it */
      }
    }),
  );
  return html.replace(bucketUrlRe(), (full) => signed.get(full) ?? full);
}

const FOLDERS =
  'org|logos|stamps|signatures|payment-details|assets|captured-images|msr-photos|msr-annotations|inventory-bind|do-start|do-ack|do-install|do-stamped|delivery-pod|job-fields|custom-fields|maintenance-reports|vehicles|bills|bank-transactions|payments|orders|documents|deliveries|organizations|images|misc';
const KEY_RE = new RegExp(`^(?:${FOLDERS})/[^\\s"'<>]+\\.[A-Za-z0-9]{2,5}$`);

/** Stored file values in a payload: keys under our folders and public bucket URLs. */
export function storedFileValues(payload: unknown, limit = 5000): string[] {
  const out = new Set<string>();
  let seen = 0;
  const one = bucketUrlRe();
  const walk = (v: unknown, depth: number) => {
    if (v == null || depth > 14 || seen > limit) return;
    if (typeof v === 'string') {
      seen++;
      const s = v.trim();
      if (s.length > 800) return;
      one.lastIndex = 0;
      if ((KEY_RE.test(s) && !s.includes('..')) || (/^https?:\/\//.test(s) && one.test(s) && !s.includes('X-Amz-Signature'))) out.add(s);
      return;
    }
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    if (typeof v === 'object' && !Buffer.isBuffer(v) && !(v instanceof Date)) for (const x of Object.values(v as object)) walk(x, depth + 1);
  };
  walk(payload, 0);
  return [...out];
}

/** { stored value → presigned URL } for every stored file in the payload. */
export async function signedFileUrlMap(payload: unknown, ttl = 3600): Promise<Record<string, string>> {
  const vals = storedFileValues(payload);
  const out: Record<string, string> = {};
  await Promise.all(
    vals.map(async (v) => {
      let key: string | null = v;
      if (/^https?:\/\//.test(v)) {
        const m = bucketUrlRe().exec(v);
        key = m ? keyFromPath(m[1]) : null;
      }
      if (!key) return;
      try {
        out[v] = await presignKey(key, ttl);
      } catch {
        /* skip */
      }
    }),
  );
  return out;
}

/**
 * On a public token GET (no Clerk session): add `fileUrls` to the returned
 * object so the page can show the files once the bucket is private.
 */
@Injectable()
export class SignedFileUrlsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    if (String(req?.method).toUpperCase() !== 'GET') return next.handle();
    return next.handle().pipe(
      switchMap((data) =>
        from(
          (async () => {
            if (!data || typeof data !== 'object' || Array.isArray(data) || Buffer.isBuffer(data) || typeof (data as any).pipe === 'function') return data;
            const fileUrls = await signedFileUrlMap(data);
            return Object.keys(fileUrls).length ? { ...data, fileUrls } : data;
          })(),
        ),
      ),
    );
  }
}

/** A URL the server itself can fetch: a public bucket URL becomes a short-lived signed one; anything else unchanged. */
export async function fetchableUrl(v: string, ttl = 600): Promise<string> {
  const m = bucketUrlRe().exec(String(v || ''));
  if (!m || m.index !== 0) return v;
  const key = keyFromPath(m[1]);
  return key ? presignKey(key, ttl) : v;
}
