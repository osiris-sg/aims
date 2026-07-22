/** READ-ONLY: locate all BIPL-JPSG recharge invoices in PROD. */
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
  const invs = await p.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE', name: { startsWith: 'BIPL-JPSG' } },
    select: { id: true, name: true, status: true, config: true, createdAt: true },
    orderBy: { name: 'asc' },
  });
  console.log(`PROD BIPL-JPSG invoices: ${invs.length}`);
  let total = 0;
  const byStatus = new Map<string, number>();
  const byCust = new Map<string, { n: number; amt: number }>();
  let synced = 0, linkedBills = 0;
  for (const i of invs) {
    const c: any = i.config || {};
    const amt = Number(c.nettTotal ?? c.xeroGross ?? 0);
    total += amt;
    byStatus.set(String(i.status), (byStatus.get(String(i.status)) || 0) + 1);
    const cust = c.customer?.name || c.customerName || '?';
    const e = byCust.get(cust) || { n: 0, amt: 0 };
    e.n++; e.amt += amt; byCust.set(cust, e);
    if (c.xeroInvoiceId) synced++;
  }
  // how many JP bills reference each invoice
  const bills = await p.document.findMany({ where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } }, select: { config: true } });
  const refCount = new Map<string, number>();
  for (const b of bills) {
    const r = ((b.config as any)?.reference || '');
    if (r.startsWith('BIPL-JPSG')) refCount.set(r, (refCount.get(r) || 0) + 1);
  }
  console.log(`Σ total: S$${total.toFixed(2)} | statuses: ${JSON.stringify([...byStatus])} | xero-linked: ${synced}`);
  console.log(`distinct invoices referenced by JP bills: ${refCount.size}`);
  console.log('\nby customer:');
  for (const [cust, e] of [...byCust.entries()].sort((a, b) => b[1].amt - a[1].amt)) console.log(`  ${cust.slice(0, 45).padEnd(45)} ${e.n} inv  S$${e.amt.toFixed(2)}`);
  console.log('\ninvoices + their referencing bill counts:');
  for (const i of invs) {
    const c: any = i.config || {};
    console.log(`  ${i.name}  ${String(i.status).padEnd(16)} S$${Number(c.nettTotal ?? c.xeroGross ?? 0).toFixed(2).padStart(9)}  bills-ref=${refCount.get(i.name!) || 0}  cust=${(c.customer?.name || c.customerName || '?').slice(0, 30)}`);
  }
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => p.$disconnect());
