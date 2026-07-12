import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
function urlFrom(envFile: string): string {
  const txt = fs.readFileSync(envFile, 'utf8');
  const m = txt.match(/^DATABASE_URL="?([^"\n]+)"?/m);
  if (!m) throw new Error(`No DATABASE_URL in ${envFile}`);
  return m[1];
}
async function check(label: string, url: string) {
  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    const c = await p.xeroConnection.findUnique({ where: { organizationId: ORG }, select: { tenantId: true, updatedAt: true, accessTokenExpiresAt: true, refreshTokenExpiresAt: true } });
    console.log(`${label}: ${c ? `updatedAt=${c.updatedAt.toISOString()} accessExp=${c.accessTokenExpiresAt.toISOString()} refreshExp=${c.refreshTokenExpiresAt.toISOString()}` : 'NONE'}`);
  } finally { await p.$disconnect(); }
}
async function main() {
  await check('DEV ', urlFrom('.env'));
  await check('PROD', urlFrom('.env.production'));
}
main().catch(e => { console.error(e.message); process.exit(1); });
