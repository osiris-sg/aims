/**
 * Void reversal journals whose ORIGINAL is already VOID (guru 2026-11-04).
 *
 * The bug: when a document is re-saved, AIMS voids the original journal AND
 * posts a reversing entry. Either alone is correct; both together remove the
 * transaction twice, leaving a standalone negative entry in the ledger:
 *
 *   JV-000306  VOID    Dr 610 180,383.14 | Cr 202 165,489.12 | Cr 820 14,894.02
 *   JV-000347  POSTED  Cr 610 180,383.14 | Dr 202 165,489.12 | Dr 820 14,894.02
 *
 * The original is void, so it contributes nothing; the live reversal then
 * subtracts revenue that was never added. On Biofuel this accounted for the
 * whole of account 202 reading BELOW Xero.
 *
 * Only reversals whose original resolves to a VOID journal are touched. A
 * reversal whose original is still POSTED is a legitimate pair and is left
 * alone, as is anything created by the Xero import.
 *
 *   npx ts-node --transpile-only scripts/void-orphaned-reversals.ts [--apply]
 */
import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';

const prisma = createScriptPrisma();
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');
const ORG = arg('org') || BIOFUEL_ORG_ID;
const m = (n: any) => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  console.log(`Biofuel · orphaned reversal journals · ${APPLY ? '*** APPLY ***' : 'DRY RUN'}\n`);

  const rev: any[] = await prisma.$queryRawUnsafe(`
    select j.id, j."journalNumber" jn, j."entryDate"::date dt,
           coalesce(j."reference",'') ref,
           round((coalesce(j."totalDebit",0))::numeric,2) dr,
           substring(coalesce(j."reference",'') from 'JV-[0-9]+') orig_num
    from "JournalEntry" j
    where j."organizationId"=$1 and j."status"='POSTED'
      and coalesce(j."createdBy",'') <> 'xero-import'
      and coalesce(j."reference",'') ilike 'Reversal of JV-%'
    order by j."totalDebit" desc`, ORG);

  const origs = await prisma.journalEntry.findMany({
    where: { organizationId: ORG, journalNumber: { in: rev.map((r) => r.orig_num).filter(Boolean) } },
    select: { journalNumber: true, status: true } });
  const status = new Map(origs.map((o) => [o.journalNumber, o.status]));

  const go = rev.filter((r) => status.get(r.orig_num) === 'VOID');
  const keep = rev.filter((r) => status.get(r.orig_num) && status.get(r.orig_num) !== 'VOID');
  const unknown = rev.filter((r) => !status.has(r.orig_num));

  console.log(`=== WOULD VOID — original is already VOID (${go.length}) ===`);
  for (const r of go)
    console.log(`  ${String(r.jn).padEnd(14)} ${r.dt?.toISOString?.().slice(0,10)} ${m(r.dr).padStart(13)}  reverses ${r.orig_num} (VOID)`);
  console.log(`  TOTAL ${m(go.reduce((s, r) => s + Number(r.dr || 0), 0))}`);
  if (keep.length) console.log(`\nleft alone — original still POSTED (legitimate pair): ${keep.length}`);
  if (unknown.length) console.log(`left alone — original not found: ${unknown.length}  (${unknown.map((u) => u.jn).join(', ')})`);

  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply.'); await prisma.$disconnect(); return; }

  let sum = 0;
  for (const r of go) {
    await prisma.journalEntry.update({
      where: { id: r.id },
      data: { status: 'VOID', voidedAt: new Date(), voidedBy: 'orphan-reversal-fix-2026-11-04' },
    });
    sum += Number(r.dr || 0);
  }
  console.log(`\n✔ voided ${go.length} orphaned reversal(s), ${m(sum)} of one-sided entries removed`);
  await prisma.$disconnect();
})().catch((e) => { console.error('❌', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
