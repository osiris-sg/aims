// For every unmatched-credit invoice ref on 443: do bills exist in AIMS that
// should offset it, and what state are they in (draft? account 442? no ref)?
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const ACC = { '23a307d7-2bed-4158-99b8-ffd407bf7fff': '442', 'b16e866d-5a25-4876-bf67-8e20f7dc6fa5': '443' } as Record<string, string>;
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const CREDIT_ONLY = ['BIPL-JPSG-INV-20260721-0040','BIPL-JPSG-INV-20260721-0039','BIPL-JPSG-INV-20260721-0038','BIPL-JPSG-INV-20260721-0037','BIPL-JPSG-INV-20260720-0168','JPINV-20260430-1ED325BD','BIPL-JPSG-INV-20260714-0041','JPINV-20260430-2CD9AA63','BIPL-JPSG-INV-20260721-0153','JPINV-20260430-D07606D1','JPINV-20260501-F7FC3DEC','BIPL-JPSG-INV-20260715-0047','BIPL-JPSG-INV-20260714-0047','BIPL-JPSG-INV-20260715-0090','BIPL-JPSG-INV-20260721-0033','BIPL-JPSG-INV-20260721-0036','BIPL-JPSG-INV-20260720-0148','BIPL-JPSG-INV-20260715-0093','BIPL-JPSG-INV-20260720-0172','BIPL-JPSG-INV-20260721-0035','BIPL-JPSG-INV-20260721-0034'];
async function main() {
  for (const ref of CREDIT_ONLY) {
    const bills: any[] = await prisma.$queryRawUnsafe(
      `SELECT name, status, config->>'reference' AS ref, config->>'xeroStatus' AS xs,
              config->'lines'->0->>'accountId' AS acct, (config->>'totalAmount')::float AS total
         FROM "Document"
        WHERE "organizationId" = $1 AND type = 'BILL' AND (config->>'reference' = $2 OR config->>'description' = 'Ref Invoice: ' || $2)`,
      ORG, ref);
    if (!bills.length) { console.log(`${ref}: NO BILLS AT ALL`); continue; }
    const sum = bills.reduce((s, b) => s + (b.total || 0), 0);
    console.log(`${ref}: ${bills.length} bills, total ${sum.toFixed(2)} — ${bills.map(b => `${b.name}[${b.xs || b.status}/${ACC[b.acct] || '?'}]`).join(' ')}`);
  }
  // The 44-list drafts: totals + account
  const REFS = `JP2606080024 JP2606080025 JP2605300031 JP2605300030 JP2605300029 JP2605300024 JP2605300022 JP2605300021 JP2605300020 JP2605300018 JP2605300016 JP2605300014 JP2605300013 JP2605300011 JP2605300010 JP2605300008 JP2605300007 JP2605210095 JP2605140108 JP2605140109 JP2605140024 JP2605140022 JP2605120135 JP2605120133 JP2605120060 JP2605120059 JP2605120058 JP2605120054 JP2605120053 JP2605120051 JP2605120049 JP2605120044 JP2605120043 JP2605120041 JP2605120040 JP2605120037 JP2605120036 JP2605120034 JP2605120032 JP2605110121 JP2605120030 JP2605120031 JP2605110122`.trim().split(/\s+/);
  const listBills: any[] = await prisma.$queryRawUnsafe(
    `SELECT name, config->>'reference' AS ref, config->>'xeroStatus' AS xs,
            config->'lines'->0->>'accountId' AS acct, (config->>'totalAmount')::float AS total
       FROM "Document" WHERE "organizationId" = $1 AND type = 'BILL' AND name = ANY($2)`, ORG, REFS);
  const t = listBills.reduce((s, b) => s + (b.total || 0), 0);
  const on442 = listBills.filter(b => ACC[b.acct] === '442').length;
  const on443 = listBills.filter(b => ACC[b.acct] === '443').length;
  const noInvRef = listBills.filter(b => !/^BIPL|^JPINV/.test(b.ref || '')).length;
  console.log(`\n44-list bills found: ${listBills.length}, total ${t.toFixed(2)}, on442=${on442}, on443=${on443}, without-invoice-ref=${noInvRef}`);
  console.log('xeroStatus tally:', JSON.stringify(listBills.reduce((a: any, b) => { a[b.xs || '??'] = (a[b.xs || '??'] || 0) + 1; return a; }, {})));
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
