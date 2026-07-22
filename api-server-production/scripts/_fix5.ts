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
  const n = await p.$executeRawUnsafe(`
    UPDATE "Document" SET config = config || jsonb_build_object(
      'nettTotal', (config->>'xeroGross')::numeric,
      'subTotal',  (config->>'xeroSubtotal')::numeric,
      'gstAmount', (config->>'xeroTax')::numeric)
    WHERE "organizationId" = $1 AND type = 'INVOICE'
      AND config->>'xeroGross' IS NOT NULL AND config->>'nettTotal' IS NULL`, ORG);
  console.log(`backfilled from xero fields: ${n}`);
  const left = await p.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM "Document" WHERE "organizationId"=$1 AND type='INVOICE' AND name LIKE 'BIPL-JPSG%' AND config->>'nettTotal' IS NULL`, ORG);
  console.log('JPSG invoices still without nettTotal:', left[0].n);
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
