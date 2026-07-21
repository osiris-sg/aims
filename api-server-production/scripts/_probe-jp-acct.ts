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
  const used = await p.chartOfAccount.findUnique({ where: { id: '85ada888-51a9-44dd-b5eb-1a34289ff6d5' }, select: { code: true, name: true } });
  console.log('account used by existing JP bills:', JSON.stringify(used));
  const ext = await p.chartOfAccount.findMany({ where: { organizationId: ORG, OR: [{ name: { contains: 'external', mode: 'insensitive' } }, { name: { contains: 'jp', mode: 'insensitive' } }, { code: { in: ['105', '442', '443'] } }] }, select: { id: true, code: true, name: true, accountType: true, isActive: true } });
  for (const a of ext) console.log(`  ${a.code.padEnd(6)} ${a.name}  (${a.accountType}, ${a.id.slice(0,8)}, active=${a.isActive})`);
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
