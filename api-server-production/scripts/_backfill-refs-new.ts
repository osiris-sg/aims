/** Stamp recharge refs (from inboundMeta.subject) on prod JP bills that lack
 *  a reference — covers bills ingested after the original backfill. */
import { PrismaClient, Prisma } from '@prisma/client';
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
  const bills = await p.document.findMany({
    where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } },
    select: { id: true, name: true, config: true },
  });
  let stamped = 0, already = 0, noRef = 0;
  for (const b of bills) {
    const c: any = b.config || {};
    if ((c.reference || '').startsWith('BIPL-JPSG')) { already++; continue; }
    const mm = String(c.inboundMeta?.subject || '').match(/(BIPL-JPSG-INV-[\d-]+)/);
    if (!mm) { noRef++; continue; }
    await p.document.update({ where: { id: b.id }, data: { config: { ...c, reference: mm[1] } as unknown as Prisma.InputJsonValue } });
    console.log(`  ${b.name} → ${mm[1]}`);
    stamped++;
  }
  console.log(`stamped=${stamped} already=${already} no-subject-ref=${noRef}`);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => p.$disconnect());
