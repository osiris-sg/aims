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
  const accts = await prisma.chartOfAccount.findMany({ where: { organizationId: ORG, code: { in: ['442', '443'] } }, select: { id: true, code: true, name: true } });
  console.log('accounts:', accts.map(a => `${a.code}=${a.id} (${a.name})`).join('\n           '));
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, name, status, config->>'reference' AS ref, config->'lines'->0->>'accountId' AS lineacct,
            config->'items'->0->>'accountId' AS itemacct, config->>'xeroBillId' AS xerobillid
       FROM "Document"
      WHERE "organizationId" = $1 AND type = 'BILL' AND name LIKE 'JP%'
        AND (config->>'reference' ILIKE '%SMM%' OR config->>'reference' ILIKE '%chuan lim%')
      ORDER BY name`, ORG);
  const byId = new Map(accts.map(a => [a.id, a.code]));
  const smm = rows.filter(r => /smm/i.test(r.ref || ''));
  const cl = rows.filter(r => /chuan lim/i.test(r.ref || ''));
  console.log(`\nSMM-ref JP bills: ${smm.length}`);
  for (const r of smm) console.log(`  ${r.name} [${r.status}] ref="${r.ref}" line=${byId.get(r.lineacct) || r.lineacct} item=${byId.get(r.itemacct) || (r.itemacct ? '?' : '-')} xero=${r.xerobillid ? 'Y' : 'N'}`);
  console.log(`\nChuan Lim-ref JP bills: ${cl.length}`);
  for (const r of cl) console.log(`  ${r.name} [${r.status}] ref="${r.ref}" line=${byId.get(r.lineacct) || r.lineacct} item=${byId.get(r.itemacct) || (r.itemacct ? '?' : '-')} xero=${r.xerobillid ? 'Y' : 'N'}`);
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
