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
  const jp = await p.document.findMany({ where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } }, select: { name: true, config: true } });
  console.log(`existing JP bills in prod: ${jp.length}`);
  console.log('names:', jp.map(d => d.name).sort().join(', ').slice(0, 600));
  if (jp[0]) {
    const c: any = jp[0].config;
    console.log('\nsample bill config keys:', Object.keys(c).sort().join(','));
    console.log('sample:', JSON.stringify({ supplierId: c.supplierId, billDate: c.billDate, billStatus: c.billStatus, subtotal: c.subtotal, taxAmount: c.taxAmount, totalAmount: c.totalAmount, amountsAre: c.amountsAre, taxCode: c.taxCode, inboundChannel: c.inboundChannel, lines: c.lines }, null, 1).slice(0, 900));
  }
  const accts = await p.chartOfAccount.findMany({ where: { organizationId: ORG, name: { contains: 'pass', mode: 'insensitive' } }, select: { id: true, code: true, name: true, isActive: true } });
  console.log('\naccounts with "pass":', accts.map(a => `${a.code} ${a.name} (${a.id.slice(0, 8)}, active=${a.isActive})`).join('\n  '));
  const sup = await p.supplier.findMany({ where: { organizationId: ORG, name: { contains: 'jurong port', mode: 'insensitive' } }, select: { id: true, name: true, supplierCode: true } });
  console.log('\nsupplier:', JSON.stringify(sup));
  const tmpl = await p.documentTemplate.findFirst({ where: { organizationId: ORG, type: 'BILL' }, select: { id: true, name: true } });
  console.log('bill template:', JSON.stringify(tmpl));
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
