import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const url = new URL(m[1]); url.searchParams.delete('pool_timeout'); url.searchParams.delete('connect_timeout');
const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url.toString() }) } as any);
async function main() {
  const rows = await p.$queryRawUnsafe<any[]>(
    `SELECT name, type, config->>'xeroSyncedAt' AS synced, config->>'xeroSyncedBy' AS by,
            config->>'xeroInvoiceId' AS xid, config->>'xeroStatus' AS xstatus
     FROM "Document"
     WHERE "organizationId" = $1 AND config->>'xeroSyncedAt' IS NOT NULL
     ORDER BY config->>'xeroSyncedAt' DESC LIMIT 10`, ORG);
  console.log(rows.length ? rows : 'no documents have been synced to Xero from prod');
  const conn = await p.xeroConnection.findUnique({ where: { organizationId: ORG }, select: { updatedAt: true, accessTokenExpiresAt: true } });
  console.log('prod XeroConnection:', conn ? `updated=${conn.updatedAt.toISOString()} accessExp=${conn.accessTokenExpiresAt.toISOString()}` : 'MISSING');
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
