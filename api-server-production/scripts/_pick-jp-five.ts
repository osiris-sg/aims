import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import * as path from 'path';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const url = new URL(m[1]); url.searchParams.delete('pool_timeout'); url.searchParams.delete('connect_timeout');
const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url.toString() }) } as any);
const DIR = '/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/6e733d78-df86-4e60-8e0d-938d4a93fe47/scratchpad/jp-bills/JP Pass application invoices 14072026';
async function main() {
  const existing = new Set((await p.document.findMany({ where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } }, select: { name: true } })).map(d => d.name));
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.pdf'));
  const fresh = files.map(f => ({ f, num: f.split('_')[0] })).filter(x => !existing.has(x.num));
  console.log(`zip pdfs=${files.length} already-in-prod=${files.length - fresh.length} fresh=${fresh.length}`);
  console.log('first 5 fresh:');
  for (const x of fresh.sort((a, b) => a.num.localeCompare(b.num)).slice(0, 5)) console.log(`  ${x.num}  ${path.join(DIR, x.f)}`);
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
