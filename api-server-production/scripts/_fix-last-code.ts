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
  const taken = new Set((await p.customer.findMany({ where: { organizationId: ORG, customerCode: { startsWith: 'CJ' } }, select: { customerCode: true } })).map(r => r.customerCode));
  let n = 1, code = '';
  do { code = `CJ${String(n).padStart(3, '0')}`; n++; } while (taken.has(code));
  const r = await p.customer.updateMany({ where: { organizationId: ORG, name: 'JV2112-01', OR: [{ customerCode: null }, { customerCode: '' }] }, data: { customerCode: code } });
  console.log(`JV2112-01 → ${code} (${r.count} row)`);
  const left = await p.customer.count({ where: { organizationId: ORG, OR: [{ customerCode: null }, { customerCode: '' }] } });
  const leftS = await p.supplier.count({ where: { organizationId: ORG, OR: [{ supplierCode: null }, { supplierCode: '' }] } });
  console.log(`prod uncoded now: customers=${left} suppliers=${leftS}`);
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
