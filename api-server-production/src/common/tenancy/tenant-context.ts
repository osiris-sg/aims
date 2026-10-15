import { AsyncLocalStorage } from 'async_hooks';

/**
 * Schema-per-org tenancy (TENANCY_MODE=per-org).
 *
 * Every org's business data lives in its own Postgres schema (org_biofuel,
 * org_ciel, …) described by its own Prisma file (prisma/tenancy/orgs/*.prisma).
 * Login + routing tables live in the global `platform` schema. The request's
 * org travels through async calls in this store so `this.prisma.<model>` can
 * resolve to the right org's client without every service passing it around.
 *
 * The store is MUTABLE on purpose: a public token route starts with orgId=null,
 * and the first query that finds its row (fan-out across orgs) fills it in so
 * the rest of that request stays inside the discovered org.
 */
export interface TenantStore {
  orgId: string | null;
}

/**
 * Read at call time, never at import. Nothing loads `.env` before this file is
 * imported (ConfigModule.forRoot runs dotenv later, while app.module is being
 * decorated), so an import-time constant only saw the flag when the launching
 * shell happened to export it. Found 2026-10-15: an API restarted from a plain
 * shell ran against dev with tenancy OFF and every query hit `public`.
 * PrismaService is constructed after ConfigModule has loaded the file, so
 * reading here is reliable.
 */
export const tenancyOn = (): boolean => process.env.TENANCY_MODE === 'per-org';

export const tenantStorage = new AsyncLocalStorage<TenantStore>();

export function currentTenantStore(): TenantStore | undefined {
  return tenantStorage.getStore();
}

export function currentOrgId(): string | null {
  return tenantStorage.getStore()?.orgId ?? null;
}

/** Run `fn` with `orgId` as the current org (crons, workers, webhooks). */
export function runAsOrg<T>(orgId: string | null, fn: () => T): T {
  return tenantStorage.run({ orgId }, fn);
}
