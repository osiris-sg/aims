/**
 * Prisma clients for a bootstrap/import script that must run on BOTH layouts:
 *   dev      → per-org tenancy: platform rows via the generated `platform`
 *              client, org rows via the generated `org-<name>` client
 *              (node_modules/.prisma-tenancy/*, from `npm run tenancy:generate`).
 *   staging/prod → the single `public` schema: one @prisma/client for both.
 *
 * `plat` holds Organization / OrgTenant / OrganizationUIConfig /
 * OrganizationModule / UserOrganization / OrganizationMemberProfile /
 * DocumentTemplate; `org` holds Role / Permission / UserRole / Supplier /
 * Asset / Category / Document / DocumentItem / AccountingSetting / TaxRate /
 * DocumentNumberFormat. On the public layout both are the same client.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

export type Env = 'dev' | 'staging' | 'prod';

export function loadEnv(env: Env) {
  const file = env === 'dev' ? '.env' : env === 'staging' ? '.env.staging' : '.env.production';
  dotenv.config({ path: path.resolve(__dirname, '..', '..', file), override: true });
  const host = new URL(process.env.DATABASE_URL as string).host;
  // Known Neon endpoints: dev = ep-steep-truth, staging = ep-odd-truth, prod = ep-icy-moon.
  const expect = env === 'dev' ? 'ep-steep-truth' : env === 'staging' ? 'ep-odd-truth' : 'ep-icy-moon';
  if (!host.includes(expect)) throw new Error(`${file} points at ${host}, not the ${env} database (${expect})`);
  return { file, host };
}

export function clientsFor(env: Env, orgSchema: string): { plat: any; org: any; layout: 'tenancy' | 'public'; disconnect: () => Promise<void> } {
  if (env !== 'dev') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    return { plat: p, org: p, layout: 'public', disconnect: () => p.$disconnect() };
  }
  if (process.env.TENANCY_MODE !== 'per-org') throw new Error('dev .env is not TENANCY_MODE=per-org');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaNeon } = require('@prisma/adapter-neon');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { neonConfig } = require('@neondatabase/serverless');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  neonConfig.webSocketConstructor = require('ws');
  const adapter = (schema: string) => {
    const url = new URL(process.env.DATABASE_URL as string);
    url.searchParams.delete('pool_timeout');
    url.searchParams.delete('connect_timeout');
    url.searchParams.delete('schema');
    return new PrismaNeon({ connectionString: url.toString() }, { schema });
  };
  const load = (name: string) => {
    const dir = path.join(process.cwd(), 'node_modules/.prisma-tenancy', name);
    if (!fs.existsSync(path.join(dir, 'index.js'))) throw new Error(`generated client ${dir} missing — run npm run tenancy:generate`);
    return require(dir);
  };
  const P = load('platform');
  const O = load(`org-${orgSchema.replace(/^org_/, '')}`);
  const plat = new P.PrismaClient({ adapter: adapter('platform') });
  const org = new O.PrismaClient({ adapter: adapter(orgSchema) });
  return { plat, org, layout: 'tenancy', disconnect: async () => { await plat.$disconnect(); await org.$disconnect(); } };
}
