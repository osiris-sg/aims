/** READ-ONLY audit: GST + account assignment for all JP bills AND all
 *  BIPL-JPSG recharge invoices in prod. */
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
const R = (n: number) => Math.round(n * 100) / 100;
async function main() {
  // account lookup
  const accts = await p.chartOfAccount.findMany({ where: { organizationId: ORG }, select: { id: true, code: true, name: true } });
  const byId = new Map(accts.map(a => [a.id, `${a.code} ${a.name}`]));

  // ---- BILLS ----
  const bills = await p.document.findMany({ where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } }, select: { name: true, config: true } });
  let billTax = 0, billTaxN = 0;
  const billAccts = new Map<string, number>();
  const badBills: string[] = [];
  for (const b of bills) {
    const c: any = b.config || {};
    if (Number(c.taxAmount || 0) !== 0 || (c.amountsAre && c.amountsAre !== 'NO_TAX')) { billTaxN++; billTax += Number(c.taxAmount || 0); badBills.push(`${b.name} tax=${c.taxAmount} amountsAre=${c.amountsAre}`); }
    for (const l of (c.lines || [])) {
      const key = l.accountId ? (byId.get(l.accountId) || `?${String(l.accountId).slice(0, 8)}`) : '(none)';
      billAccts.set(key, (billAccts.get(key) || 0) + 1);
    }
  }
  console.log(`=== JP BILLS: ${bills.length} ===`);
  console.log(`with GST/tax problems: ${billTaxN}`);
  for (const s of badBills.slice(0, 10)) console.log('  ✗', s);
  console.log('line accounts:', JSON.stringify([...billAccts]));

  // ---- INVOICES ----
  const invs = await p.document.findMany({ where: { organizationId: ORG, type: 'INVOICE', name: { startsWith: 'BIPL-JPSG' } }, select: { name: true, status: true, config: true } });
  let gstN = 0, gstSum = 0;
  const invAccts = new Map<string, number>();
  const gstInvs: string[] = [];
  for (const i of invs) {
    const c: any = i.config || {};
    const gst = Number(c.gstAmount || 0);
    if (gst > 0.005) { gstN++; gstSum += gst; gstInvs.push(`${i.name} [${i.status}] gst=${gst} nett=${c.nettTotal} src=${typeof c.source === 'object' ? c.source?.extractedFrom : c.source}`); }
    for (const it of (c.items || [])) {
      const key = it.accountCode ? String(it.accountCode) : '(none)';
      invAccts.set(key, (invAccts.get(key) || 0) + 1);
    }
  }
  console.log(`\n=== BIPL-JPSG INVOICES: ${invs.length} ===`);
  console.log(`with GST > 0: ${gstN} (Σ GST ${R(gstSum)})`);
  for (const s of gstInvs) console.log('  ', s);
  console.log('item accountCodes:', JSON.stringify([...invAccts]));
  // resolve codes to names
  const codes = [...invAccts.keys()].filter(k => k !== '(none)');
  for (const code of codes) {
    const a = accts.find(x => x.code === code);
    console.log(`  code ${code} = ${a ? a.name : 'NOT IN CoA'}`);
  }
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => p.$disconnect());
