// Per-reference reconciliation of account 443: each JPSG invoice ref should
// net 0 (invoice credit offset by pass-bill debits). Lists refs that don't.
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const normRef = (r: string | null) => (r || '(none)').replace(/\s*\(JP Pass Application\)\s*$/i, '').trim() || '(none)';
async function main() {
  const acct = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, code: '443' }, select: { id: true } });
  const lines = await prisma.journalEntryLine.findMany({
    where: { accountId: acct!.id, journalEntry: { organizationId: ORG, status: 'POSTED' } },
    include: { journalEntry: { select: { reference: true, type: true, entryDate: true } } },
  });
  const agg = new Map<string, { dr: number; cr: number; types: Set<string> }>();
  for (const l of lines) {
    const key = normRef(l.journalEntry.reference);
    if (!agg.has(key)) agg.set(key, { dr: 0, cr: 0, types: new Set() });
    const a = agg.get(key)!;
    a.dr += l.debit; a.cr += l.credit; a.types.add(l.journalEntry.type);
  }
  const bad = [...agg.entries()].map(([ref, a]) => ({ ref, net: Math.round((a.dr - a.cr) * 100) / 100, dr: a.dr, cr: a.cr, types: [...a.types].join('+') }))
    .filter(x => Math.abs(x.net) > 0.005)
    .sort((x, y) => x.net - y.net);
  console.log(`refs on 443: ${agg.size}, unbalanced: ${bad.length}`);
  let total = 0;
  for (const b of bad) { total += b.net; console.log(`  ${b.ref}  DR ${b.dr.toFixed(2)}  CR ${b.cr.toFixed(2)}  NET ${b.net.toFixed(2)}  [${b.types}]`); }
  console.log(`TOTAL NET ${total.toFixed(2)}`);
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
