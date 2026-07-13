// Mark the 28 stamped 11-Jul BIPL-JPSG invoices TAX INCLUSIVE: editor-shape
// documentInfo (absorbTax Y, taxCode 1, gstPercent 9) + GST backed out of the
// gross line total. Usage: npx ts-node scripts/fix-jp-inv-inclusive.ts [--apply]
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const APPLY = process.argv.includes('--apply');
const EXCLUDE = new Set(['BIPL-JPSG-INV-20260521-0001', 'BIPL-JPSG-INV-20260524-0001']);
const R = (n: number) => Math.round(n * 100) / 100;
async function main() {
  const docs = await p.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE', name: { startsWith: 'BIPL-JPSG' } },
    select: { id: true, name: true, createdAt: true, config: true },
  });
  const targets = docs.filter((d) => d.createdAt.toISOString().slice(0, 10) === '2026-07-11' && !EXCLUDE.has(d.name || ''));
  let changed = 0;
  for (const d of targets) {
    const c: any = d.config || {};
    const gross = R((c.items ?? c.lines ?? []).reduce((s: number, it: any) => s + (Number(it.amount) || 0), 0));
    const gst = R((gross * 9) / 109);
    const next = {
      ...c,
      documentInfo: {
        ...(c.documentInfo || {}),
        taxApplicable: 'Y',
        absorbTax: 'Y',
        taxCode: '1',
        gstPercent: 9,
        subTotal: R(gross - gst),
        gstAmount: gst,
        nettTotal: gross,
      },
    };
    if (changed < 3) console.log(`  ${d.name}: gross=${gross} -> sub=${R(gross - gst)} gst=${gst} nett=${gross}`);
    if (APPLY) await p.document.update({ where: { id: d.id }, data: { config: next } });
    changed++;
  }
  console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'}: ${changed} invoices -> tax inclusive (code 1 @9%)`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
