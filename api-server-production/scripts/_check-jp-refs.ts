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
  const bills = await p.document.findMany({ where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } }, select: { name: true, config: true } });
  const refs = new Map<string, number>();
  const specific: Array<{ name: string; ref: string }> = [];
  for (const b of bills) {
    const c: any = b.config || {};
    const r = (c.reference || '').trim();
    refs.set(r || '(empty)', (refs.get(r || '(empty)') || 0) + 1);
    if (r && r !== 'JP Pass application') specific.push({ name: b.name!, ref: r });
    // also check inboundMeta / other linkage fields
  }
  console.log('reference distribution:', JSON.stringify([...refs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)));
  console.log(`bills with specific refs: ${specific.length}`);
  for (const s of specific.slice(0, 20)) console.log(`  ${s.name} → "${s.ref}"`);
  // any linkage in inboundMeta?
  const meta = bills.filter(b => (b.config as any)?.inboundMeta).slice(0, 3);
  for (const b of meta) console.log(`meta sample ${b.name}:`, JSON.stringify((b.config as any).inboundMeta).slice(0, 200));
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
