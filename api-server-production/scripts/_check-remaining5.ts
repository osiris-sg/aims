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
  const rows = await p.$queryRawUnsafe<any[]>(`
    SELECT name, status::text AS status, config->>'source' AS source,
           (SELECT sum((it->>'amount')::numeric) FROM jsonb_array_elements(config->'items') it) AS items_sum
    FROM "Document" WHERE "organizationId" = $1 AND type = 'INVOICE' AND name LIKE 'BIPL-JPSG%' AND config->>'nettTotal' IS NULL`, ORG);
  for (const r of rows) console.log(JSON.stringify(r));
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
