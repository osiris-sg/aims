import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
async function main() {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, name, type, status, config->>'reference' AS ref,
            LEFT(config::text, 0) AS z
       FROM "Document"
      WHERE "organizationId" = $1 AND config::text ILIKE '%chuan%lim%'
      ORDER BY type, name`, ORG);
  console.log('docs mentioning chuan lim:', rows.length);
  for (const r of rows) console.log(`  ${r.type} ${r.name} [${r.status}] ref="${r.ref}"`);
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
