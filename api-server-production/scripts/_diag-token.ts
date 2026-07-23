import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const p = new PrismaClient({ datasources: { db: { url: m[1] } } });
async function main() {
  const c = await p.xeroConnection.findUnique({ where: { organizationId: ORG } });
  if (!c) throw new Error('no conn');
  console.log(`stored tenantId=${c.tenantId} accessExp=${c.accessTokenExpiresAt.toISOString()}`);
  // decode JWT payload to inspect scopes (no external call)
  const payload = JSON.parse(Buffer.from(c.accessToken.split('.')[1], 'base64').toString());
  console.log('token scopes:', payload.scope?.join?.(' ') || payload.scope);
  console.log('token authentication_event_id:', payload.authentication_event_id);
  const res = await fetch('https://api.xero.com/connections', { headers: { Authorization: `Bearer ${c.accessToken}` } });
  const body: any = await res.json().catch(() => null);
  console.log(`/connections ${res.status}:`, JSON.stringify(body)?.slice(0, 400));
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => p.$disconnect());
