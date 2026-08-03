import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const REFS = `JP2606080024 JP2606080025 JP2605300031 JP2605300030 JP2605300029 JP2605300024 JP2605300022 JP2605300021 JP2605300020 JP2605300018 JP2605300016 JP2605300014 JP2605300013 JP2605300011 JP2605300010 JP2605300008 JP2605300007 JP2605210095 JP2605140108 JP2605140109 JP2605140024 JP2605140022 JP2605120135 JP2605120133 JP2605120060 JP2605120059 JP2605120058 JP2605120054 JP2605120053 JP2605120051 JP2605120049 JP2605120044 JP2605120043 JP2605120041 JP2605120040 JP2605120037 JP2605120036 JP2605120034 JP2605120032 JP2605110121 JP2605120030 JP2605120031 JP2605110122 JP2607170118`.trim().split(/\s+/);
async function main() {
  const docs = await prisma.document.findMany({
    where: { organizationId: ORG, type: 'BILL', name: { in: REFS } },
    select: { name: true, config: true },
  });
  const byName = new Map(docs.map(d => [d.name, d]));
  const tally = new Map<string, string[]>();
  for (const r of REFS) {
    const d = byName.get(r);
    if (!d) { (tally.get('NOT IN PROD') || tally.set('NOT IN PROD', []).get('NOT IN PROD'))!.push(r); continue; }
    const c: any = d.config || {};
    const ref: string = c.reference || '';
    // "JPxxxx (CUSTOMER)" pattern → extract customer; else use the raw ref.
    const mm = ref.match(/\(([^)]+)\)\s*$/);
    const who = mm ? mm[1] : ref || (c.description || '(no reference)');
    if (!tally.has(who)) tally.set(who, []);
    tally.get(who)!.push(r);
  }
  for (const [who, list] of tally) {
    console.log(`\n${who} — ${list.length} bills:`);
    console.log('  ' + list.join(', '));
  }
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
