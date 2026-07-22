/** READ-ONLY: locate all JP Pass bills in PROD with their current state. */
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
  const bills = await p.document.findMany({
    where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } },
    select: { id: true, name: true, status: true, config: true, attachments: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  let total = 0, synced = 0, withPdf = 0, withRef = 0, draft = 0;
  const byMonth = new Map<string, { n: number; amt: number }>();
  for (const b of bills) {
    const c: any = b.config || {};
    total += Number(c.totalAmount || 0);
    if (c.xeroBillId) synced++;
    if ((Array.isArray(b.attachments) && (b.attachments as any[]).length) || c.xeroPdfAttached) withPdf++;
    if ((c.reference || '').startsWith('BIPL-JPSG-INV')) withRef++;
    if ((c.billStatus || 'DRAFT') === 'DRAFT') draft++;
    const mth = (c.billDate || '').slice(0, 7) || '?';
    const e = byMonth.get(mth) || { n: 0, amt: 0 };
    e.n++; e.amt += Number(c.totalAmount || 0);
    byMonth.set(mth, e);
  }
  console.log(`PROD JP Pass bills: ${bills.length}`);
  console.log(`  Σ total: S$${total.toFixed(2)}`);
  console.log(`  status DRAFT: ${draft} | synced to Xero: ${synced} | PDF attached: ${withPdf} | recharge-ref: ${withRef}`);
  console.log('\n  by month:');
  for (const [mth, e] of [...byMonth.entries()].sort()) console.log(`    ${mth}: ${e.n} bills  S$${e.amt.toFixed(2)}`);
  console.log('\n  first 5:', bills.slice(0, 5).map(b => b.name).join(', '));
  console.log('  last 5: ', bills.slice(-5).map(b => b.name).join(', '));
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => p.$disconnect());
