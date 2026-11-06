import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * Idempotency-Key (2026-11-06, SiteClock deliveries): a phone on bad signal
 * resends a start / sign-off / photo when it never saw the answer. With the
 * header, the first request runs and its answer is stored; a repeat with the
 * same key and the same body gets that answer back without running again, a
 * repeat with a DIFFERENT body is refused (422), and a repeat that arrives
 * while the first is still running gets 409 (try again shortly).
 *
 * Requests without the header behave exactly as before (SiteJobs sends none).
 * A failed first attempt stores nothing, so its retry runs normally.
 * Rows live in "IdempotencyRecord" (platform / public); a key is remembered
 * for 24 hours. Raw SQL, like deliveries/run-lease.ts.
 */
export const IDEMPOTENCY_TTL_HOURS = 24;
/** A PENDING row older than this is treated as abandoned (its request died). */
const STALE_PENDING_SECS = 120;
export const MAX_KEY_LENGTH = 200;

export const IDEMPOTENCY_IN_PROGRESS = 'The same request is still being processed. Try again in a moment.';
export const IDEMPOTENCY_MISMATCH = 'This Idempotency-Key was already used for a different request.';

export function cleanIdempotencyKey(raw: unknown): string | null {
  const k = typeof raw === 'string' ? raw.trim() : Array.isArray(raw) ? String(raw[0] ?? '').trim() : '';
  if (!k) return null;
  if (k.length > MAX_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(k)) throw new UnprocessableEntityException('Idempotency-Key must be 1-200 visible ASCII characters');
  return k;
}

/** Stable JSON (object keys sorted) so the same body always hashes the same. */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  return `{${Object.keys(v as any)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson((v as any)[k])}`)
    .join(',')}}`;
}

export function requestHashOf(parts: { method: string; path: string; body?: unknown; fileSha?: string | null }) {
  return createHash('sha256').update(`${parts.method.toUpperCase()} ${parts.path}\n${stableJson(parts.body ?? null)}\n${parts.fileSha ?? ''}`).digest('hex');
}

export type IdemCall = { organizationId: string; scope: string; key: string; requestHash: string };

/**
 * Run `fn` once for (org, scope, key). Returns its value, or the stored value of
 * the earlier run. Errors from `fn` propagate and leave no record behind.
 */
export async function runIdempotent<T>(prisma: any, call: IdemCall, fn: () => Promise<T>): Promise<{ value: T; replayed: boolean }> {
  const id = createHash('sha256').update(`${call.organizationId}|${call.scope}|${call.key}`).digest('hex');
  const taken: Array<{ id: string }> = await prisma.$queryRaw`
    INSERT INTO "IdempotencyRecord" (id, "organizationId", scope, "requestHash", state, "createdAt", "updatedAt")
    VALUES (${id}, ${call.organizationId}, ${call.scope}, ${call.requestHash}, 'PENDING', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
    ON CONFLICT (id) DO UPDATE
      SET "requestHash" = EXCLUDED."requestHash", state = 'PENDING', "statusCode" = NULL, response = NULL,
          "createdAt" = EXCLUDED."createdAt", "updatedAt" = EXCLUDED."updatedAt"
      WHERE "IdempotencyRecord"."createdAt" < (now() AT TIME ZONE 'UTC') - make_interval(hours => ${IDEMPOTENCY_TTL_HOURS}::int)
         OR ("IdempotencyRecord".state = 'PENDING' AND "IdempotencyRecord"."updatedAt" < (now() AT TIME ZONE 'UTC') - make_interval(secs => ${STALE_PENDING_SECS}::double precision))
    RETURNING id`;
  if (!taken.length) {
    const rows: Array<{ requestHash: string; state: string; response: any }> = await prisma.$queryRaw`
      SELECT "requestHash", state, response FROM "IdempotencyRecord" WHERE id = ${id}`;
    const row = rows[0];
    if (!row) throw new ConflictException({ message: IDEMPOTENCY_IN_PROGRESS, data: { code: 'IDEMPOTENCY_IN_PROGRESS' } });
    if (row.requestHash !== call.requestHash) throw new UnprocessableEntityException({ message: IDEMPOTENCY_MISMATCH, data: { code: 'IDEMPOTENCY_MISMATCH' } });
    if (row.state !== 'DONE') throw new ConflictException({ message: IDEMPOTENCY_IN_PROGRESS, data: { code: 'IDEMPOTENCY_IN_PROGRESS' } });
    return { value: (row.response?.v ?? null) as T, replayed: true };
  }
  let value: T;
  try {
    value = await fn();
  } catch (e) {
    await prisma.$executeRaw`DELETE FROM "IdempotencyRecord" WHERE id = ${id} AND state = 'PENDING'`.catch(() => undefined);
    throw e;
  }
  // Wrapped in { v } so a null / scalar answer stores as valid JSON.
  const stored = JSON.stringify({ v: value === undefined ? null : value });
  await prisma.$executeRaw`
    UPDATE "IdempotencyRecord" SET state = 'DONE', "statusCode" = 200, response = ${stored}::jsonb, "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE id = ${id}`.catch(() => undefined);
  return { value, replayed: false };
}
