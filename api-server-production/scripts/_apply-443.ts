/** Apply accountant's new 443 "JP Pass Application (External Customers)":
 *  - PROD bills WITH a recharge ref → lines to 443; others stay 442
 *  - the 22 unswept bills: NO_TAX + account (443 if ref'd else 442)
 *  - recharge INVOICE pass items (105 Contra or none) → 443  [disposal 209 untouched]
 *  - strip GST from the 2 pass invoices that wrongly carry it */
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
const R = (n: number) => Math.round(n * 100) / 100;
async function main() {
  // ensure 443 exists in PROD AIMS CoA (mirror Xero)
  let a443 = await p.chartOfAccount.findFirst({ where: { organizationId: ORG, code: '443' } });
  if (!a443) a443 = await p.chartOfAccount.create({ data: { organizationId: ORG, code: '443', name: 'JP Pass Application - Transportation (External Customers)', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT', isActive: true } });
  const a442 = await p.chartOfAccount.findFirst({ where: { organizationId: ORG, code: '442' } });
  console.log(`443=${a443.id.slice(0,8)} 442=${a442!.id.slice(0,8)}`);

  // ---- bills ----
  const bills = await p.document.findMany({ where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } }, select: { id: true, name: true, config: true } });
  let to443 = 0, kept442 = 0, fixed22 = 0;
  for (const b of bills) {
    const c: any = b.config || {};
    const external = (c.reference || '').startsWith('BIPL-JPSG');
    const target = external ? a443.id : a442!.id;
    const lines = (c.lines || []).map((l: any) => ({ ...l, accountId: target }));
    const needsTax = Number(c.taxAmount || 0) !== 0 || c.amountsAre !== 'NO_TAX' || Number(c.subtotal) !== Number(c.totalAmount);
    const needsAcct = (c.lines || []).some((l: any) => l.accountId !== target);
    if (!needsTax && !needsAcct) { external ? to443 : kept442; if (external) to443++; else kept442++; continue; }
    await p.document.update({ where: { id: b.id }, data: { config: { ...c, lines, subtotal: Number(c.totalAmount ?? c.subtotal ?? 0), taxAmount: 0, amountsAre: 'NO_TAX' } as unknown as Prisma.InputJsonValue } });
    if (needsTax) fixed22++;
    if (external) to443++; else kept442++;
  }
  console.log(`bills: external→443=${to443} internal(442)=${kept442} tax-normalized=${fixed22}`);

  // ---- recharge invoices: pass items → 443; strip wrong GST ----
  const invs = await p.document.findMany({ where: { organizationId: ORG, type: 'INVOICE', name: { startsWith: 'BIPL-JPSG' } }, select: { id: true, name: true, config: true } });
  let invFixed = 0, gstStripped = 0;
  for (const i of invs) {
    const c: any = i.config || {};
    const items = c.items || [];
    const isDisposal = items.some((it: any) => String(it.accountCode) === '209' || it.weightT != null || it.materialType);
    if (isDisposal) continue; // taxable disposal invoices untouched
    let changed = false;
    const newItems = items.map((it: any) => {
      if (String(it.accountCode || '') !== '443') { changed = true; return { ...it, accountCode: '443' }; }
      return it;
    });
    const patch: any = { items: newItems };
    if (Number(c.gstAmount || 0) > 0.005) { // pass recharge must be no-GST
      patch.gstAmount = 0;
      patch.subTotal = Number(c.nettTotal ?? c.subTotal ?? 0);
      gstStripped++;
      changed = true;
    }
    if (changed) { await p.document.update({ where: { id: i.id }, data: { config: { ...c, ...patch } as unknown as Prisma.InputJsonValue } }); invFixed++; }
  }
  console.log(`recharge invoices: items→443 on ${invFixed}, GST stripped on ${gstStripped}`);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => p.$disconnect());
