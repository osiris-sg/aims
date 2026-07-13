// Point every line of the 165 email-ingested JP draft bills at account 105
// (Contra account). Usage: npx ts-node scripts/fix-jp-bills-account.ts [--apply]
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const APPLY = process.argv.includes('--apply');
async function main() {
  const acct = await p.chartOfAccount.findFirst({ where: { organizationId: ORG, code: '105', isActive: true }, select: { id: true, code: true, name: true } });
  if (!acct) throw new Error('Account 105 not found');
  const docs = await p.document.findMany({
    where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP' } },
    select: { id: true, name: true, createdAt: true, config: true },
  });
  const targets = docs.filter((d) => d.createdAt.toISOString().slice(0, 10) === '2026-07-11');
  let changed = 0, lines = 0, skippedNonDraft = 0;
  for (const d of targets) {
    const c: any = d.config || {};
    if ((c.billStatus || '').toUpperCase() !== 'DRAFT') { skippedNonDraft++; continue; }
    const newLines = (c.lines || []).map((l: any) => ({ ...l, accountId: acct.id }));
    lines += newLines.length;
    if (APPLY) await p.document.update({ where: { id: d.id }, data: { config: { ...c, lines: newLines, items: newLines } } });
    changed++;
  }
  console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'}: ${changed} bills / ${lines} lines -> ${acct.code} ${acct.name} (${acct.id}), skipped non-draft=${skippedNonDraft}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
