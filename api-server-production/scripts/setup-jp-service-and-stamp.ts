// 1) Ensure RevenueItem SV025 "Jurong Port Pass Application (External)"
//    (accountCode 105) exists in this env — transferred from dev.
// 2) Stamp itemCode SV025 (+ isService/revenueTag/accountCode) on every
//    "Pass Application" line of the 11-Jul BIPL-JPSG invoices, except the two
//    Jul-02-batch invoices guru excluded.
// Usage: DATABASE_URL=... npx ts-node scripts/setup-jp-service-and-stamp.ts [--apply] [--service-only]
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const APPLY = process.argv.includes('--apply');
const SERVICE_ONLY = process.argv.includes('--service-only');
const EXCLUDE = new Set(['BIPL-JPSG-INV-20260521-0001', 'BIPL-JPSG-INV-20260524-0001']);
async function main() {
  // --- service master ---
  const acct = await p.chartOfAccount.findFirst({ where: { organizationId: ORG, code: '105' }, select: { id: true, name: true, isActive: true } });
  console.log('account 105:', acct ? `${acct.name} (active=${acct.isActive})` : 'MISSING');
  let svc = await p.revenueItem.findFirst({ where: { organizationId: ORG, code: 'SV025' } });
  if (!svc) {
    console.log(`SV025 missing -> ${APPLY ? 'creating' : 'would create'} "Jurong Port Pass Application (External)" -> 105`);
    if (APPLY) {
      svc = await p.revenueItem.create({
        data: { organizationId: ORG, code: 'SV025', name: 'Jurong Port Pass Application (External)', type: 'SERVICE', accountCode: '105', accountId: acct?.id ?? null, isActive: true },
      });
    }
  } else {
    console.log('SV025 already present:', svc.name);
  }
  if (SERVICE_ONLY) return;
  // --- stamp invoice lines ---
  const docs = await p.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE', name: { startsWith: 'BIPL-JPSG' } },
    select: { id: true, name: true, createdAt: true, config: true },
  });
  const targets = docs.filter((d) => d.createdAt.toISOString().slice(0, 10) === '2026-07-11' && !EXCLUDE.has(d.name || ''));
  let docsChanged = 0, linesStamped = 0, excluded = docs.filter((d) => EXCLUDE.has(d.name || '')).length;
  for (const d of targets) {
    const c: any = d.config || {};
    let touched = false;
    const stamp = (arr: any[]) => arr.map((it: any) => {
      if (/pass application/i.test(String(it.description || '')) && it.itemCode !== 'SV025') {
        touched = true; linesStamped++;
        return { ...it, itemCode: 'SV025', isService: true, revenueTag: 'service', accountCode: '105' };
      }
      return it;
    });
    const next: any = { ...c };
    if (Array.isArray(c.items)) next.items = stamp(c.items);
    if (Array.isArray(c.lines)) next.lines = stamp(c.lines);
    if (!touched) continue;
    if (APPLY) await p.document.update({ where: { id: d.id }, data: { config: next } });
    docsChanged++;
  }
  console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'}: ${docsChanged} invoices, ${linesStamped} lines -> SV025/105; excluded-by-name found in set: ${excluded}; targeted ${targets.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
