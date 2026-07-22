import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const p = new PrismaClient({ datasources: { db: { url: m[1] } } });
async function main() {
  const c = await p.xeroConnection.findUnique({ where: { organizationId: ORG }, select: { tenantId: true, createdAt: true, accessTokenExpiresAt: true, refreshTokenExpiresAt: true } });
  console.log(c ? `✓ connected: tenant=${c.tenantId} created=${c.createdAt.toISOString()} accessExp=${c.accessTokenExpiresAt.toISOString()} refreshExp=${c.refreshTokenExpiresAt.toISOString()}` : '✗ no connection yet');
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
