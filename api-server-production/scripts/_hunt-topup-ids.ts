/** Search prod DB for Airwallex topup UUIDs to auto-build the customer mapping. */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const url = new URL(m[1]); url.searchParams.delete('pool_timeout'); url.searchParams.delete('connect_timeout');
const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url.toString() }) } as any);
const SAMPLE = ['59926524-8a27-4545-b629', 'cbd33647-005b-458a-9942', '0e2ef863-25a4-46b0-adf8', 'f7fc3dec-4c47-4492-8738'];
async function main() {
  // any table with a text/jsonb column containing these? quick sweep over likely tables
  for (const s of SAMPLE.slice(0, 2)) {
    const hits = await p.$queryRawUnsafe<any[]>(
      `SELECT 'Document' AS tbl, id::text, name FROM "Document" WHERE config::text ILIKE '%' || $1 || '%'
       UNION ALL
       SELECT 'PassTrackerEntry', id::text, NULL FROM "PassTrackerEntry" WHERE to_jsonb("PassTrackerEntry")::text ILIKE '%' || $1 || '%'
       UNION ALL
       SELECT 'AuditLog', id::text, NULL FROM "AuditLog" WHERE to_jsonb("AuditLog")::text ILIKE '%' || $1 || '%'
       LIMIT 5`, s).catch((e) => [{ tbl: 'ERR', id: (e.message || '').slice(0, 120) }]);
    console.log(`${s}:`, hits.length ? hits : 'no hits');
  }
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
