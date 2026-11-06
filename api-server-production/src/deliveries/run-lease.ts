import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';

/**
 * A short lease on a delivery run (2026-11-06, SiteClock deliveries). Two
 * devices can now work the same run (SiteJobs and SiteClock), so the
 * multi-step sign-offs — finalize, finalize-return — must not interleave: the
 * second one would pass the same "not completed yet" check and run the DO
 * commit, the invoice and the WhatsApp post a second time.
 *
 * The lease is one row per run in "DeliveryOpLease" (platform / public). Taking
 * it is one atomic INSERT … ON CONFLICT: it succeeds when nobody holds the run
 * or the holder's lease has expired (a crashed request never blocks a run for
 * longer than the TTL). Whoever loses gets a 409 with a sentence for the phone.
 * The holder re-reads the run after taking the lease, so the second request in
 * line then sees "already finalized" and stops before any side effect.
 *
 * Raw SQL on purpose: the table is outside the org schemas, and the tenancy
 * router runs raw statements with search_path "<org>", platform, public.
 */
export const RUN_LEASE_TTL_MS = 2 * 60_000;

export const RUN_BUSY_MESSAGE = 'This job is being updated on another device. Wait a moment and try again.';

export async function withRunLease<T>(
  prisma: any,
  lease: { organizationId: string; deliveryId: string; op: string; ttlMs?: number },
  fn: () => Promise<T>,
): Promise<T> {
  const holder = randomUUID();
  const ttl = Math.max(5_000, lease.ttlMs ?? RUN_LEASE_TTL_MS);
  const got: Array<{ holder: string }> = await prisma.$queryRaw`
    INSERT INTO "DeliveryOpLease" (id, "organizationId", op, holder, "expiresAt", "createdAt")
    VALUES (${lease.deliveryId}, ${lease.organizationId}, ${lease.op}, ${holder},
            (now() AT TIME ZONE 'UTC') + make_interval(secs => ${ttl / 1000}::double precision),
            (now() AT TIME ZONE 'UTC'))
    ON CONFLICT (id) DO UPDATE
      SET op = EXCLUDED.op, holder = EXCLUDED.holder, "expiresAt" = EXCLUDED."expiresAt", "organizationId" = EXCLUDED."organizationId"
      WHERE "DeliveryOpLease"."expiresAt" < (now() AT TIME ZONE 'UTC')
    RETURNING holder`;
  if (got[0]?.holder !== holder) throw new ConflictException({ message: RUN_BUSY_MESSAGE, data: { code: 'RUN_BUSY' } });
  try {
    return await fn();
  } finally {
    await prisma.$executeRaw`DELETE FROM "DeliveryOpLease" WHERE id = ${lease.deliveryId} AND holder = ${holder}`.catch(() => undefined);
  }
}
