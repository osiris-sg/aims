// Mark the 165 email-ingested Jurong Port DRAFT bills (created 2026-07-11) as
// TAX INCLUSIVE: amountsAre + documentInfo.taxCode/gstPercent/absorbTax, and
// back the 9% GST out of the gross line total (tax = gross*9/109).
// Usage: npx ts-node scripts/fix-jp-bills-inclusive.ts [--apply]
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const APPLY = process.argv.includes('--apply');
const R = (n: number) => Math.round(n * 100) / 100;
async function main() {
  const docs = await p.document.findMany({
    where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP' } },
    select: { id: true, name: true, status: true, createdAt: true, config: true },
  });
  const targets = docs.filter((d) => d.createdAt.toISOString().slice(0, 10) === '2026-07-11');
  let changed = 0, skippedNonDraft = 0;
  for (const d of targets) {
    const c: any = d.config || {};
    if ((c.billStatus || '').toUpperCase() !== 'DRAFT') { skippedNonDraft++; continue; }
    const gross = R((c.lines || []).reduce((s: number, l: any) => s + (Number(l.amount) || 0), 0));
    const tax = R((gross * 9) / 109);
    const next = {
      ...c,
      amountsAre: 'INCLUSIVE',
      subtotal: R(gross - tax),
      taxAmount: tax,
      totalAmount: gross,
      documentInfo: { ...(c.documentInfo || {}), taxCode: '4', gstPercent: 9, absorbTax: true },
    };
    if (changed < 5) console.log(`  ${d.name}: gross=${gross} -> sub=${next.subtotal} tax=${tax} total=${gross}`);
    if (APPLY) await p.document.update({ where: { id: d.id }, data: { config: next } });
    changed++;
  }
  console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'}: ${changed} bills -> INCLUSIVE, skipped non-draft=${skippedNonDraft}, of ${targets.length} targeted`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
