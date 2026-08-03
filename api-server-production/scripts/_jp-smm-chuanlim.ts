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
    `SELECT id, name, type, status, config FROM "Document"
      WHERE "organizationId" = $1 AND type = 'BILL'
        AND (config::text ILIKE '%SMM%' OR config::text ILIKE '%chuan lim%' OR config::text ILIKE '%chuanlim%')
      ORDER BY name`, ORG);
  console.log('matches:', rows.length);
  for (const r of rows.slice(0, 8)) {
    const c = r.config || {};
    console.log(`\n${r.name} [${r.status}]`);
    console.log('  keys:', Object.keys(c).join(','));
    for (const k of ['reference','description','supplierName','supplierId','customerName','externalCustomer','accountCode','lines','items','passHolder','remarks']) {
      const v = c[k];
      if (v !== undefined && v !== null) console.log(`  ${k}:`, JSON.stringify(v).slice(0, 300));
    }
  }
  if (rows.length > 8) console.log(`...and ${rows.length - 8} more:`, rows.slice(8).map((r: any) => r.name).join(', '));
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
