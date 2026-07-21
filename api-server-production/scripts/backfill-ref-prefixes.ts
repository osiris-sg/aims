// Backfill doc-type prefixes onto existing journal references (guru's prefix
// plan, 2026-07-20): re-stamps JournalEntry.reference as "{PREFIX} {number}"
// so old journals match the new posting behaviour in every report.
//   - source doc found: OFFICIAL_RECEIPT → REC; MANUAL_OFFSET → skipped (a
//     function, not a doc type); PAYMENT-type entries → REC; else by doc type
//     (INV, C/N, D/N, SIN, PO, PR, ...).
//   - no source doc: BILL-type → SIN; PAYMENT + "Payment voucher" → P/V;
//     PAYMENT + "Auto-posted from payment" → REC; anything else untouched.
// Already-prefixed references are left alone (isPrefixed guard). Dry run by
// default — pass --apply to write.
//
// Usage: npx ts-node scripts/backfill-ref-prefixes.ts [--apply]

import { PrismaClient } from '@prisma/client';
import { docRef, refWith } from '../src/common/doc-ref';

const p = new PrismaClient();
const APPLY = process.argv.includes('--apply');

// Same bank/cash test as JournalService.isCashOrBankAccount.
function isCashOrBank(a: { code: string; name?: string | null; accountType?: string | null }): boolean {
  if (a.code === 'CA004' || a.code === 'CA600' || a.code === 'CA006' || /^CA1\d{2}$/.test(a.code)) return true;
  if (a.accountType === 'FOREIGN_BANK') return true;
  if (a.accountType === 'CURRENT_ASSET' && a.name) {
    const n = a.name.toLowerCase();
    return /\bbank\b/.test(n) || /\bcash\b/.test(n);
  }
  return false;
}

async function main() {
  const entries = await p.journalEntry.findMany({
    where: { reference: { not: null } },
    select: { id: true, type: true, reference: true, description: true, sourceDocumentId: true, organizationId: true },
  });
  console.log(`Scanning ${entries.length} journal entries with references...`);

  const docIds = [...new Set(entries.map((e) => e.sourceDocumentId).filter(Boolean))] as string[];
  const docs = docIds.length
    ? await p.document.findMany({ where: { id: { in: docIds } }, select: { id: true, type: true } })
    : [];
  const docTypeById = new Map(docs.map((d) => [d.id, d.type]));

  // Imported PAYMENT journals carry no source doc — classify by the bank
  // line's direction: bank DEBITED = money in → REC; bank CREDITED = money
  // out → P/V (guru 2026-07-20: stamp these like everything else).
  const paymentIds = entries.filter((e) => e.type === 'PAYMENT' && !e.sourceDocumentId).map((e) => e.id);
  const bankNetByEntry = new Map<string, number>();
  const CHUNK = 2000;
  for (let i = 0; i < paymentIds.length; i += CHUNK) {
    const lines = await p.journalEntryLine.findMany({
      where: { journalEntryId: { in: paymentIds.slice(i, i + CHUNK) } },
      select: { journalEntryId: true, debit: true, credit: true, accountId: true },
    });
    const accIds = [...new Set(lines.map((l) => l.accountId))];
    const accs = await p.chartOfAccount.findMany({
      where: { id: { in: accIds } },
      select: { id: true, code: true, name: true, accountType: true },
    });
    const accById = new Map(accs.map((a) => [a.id, a]));
    for (const l of lines) {
      const acc = accById.get(l.accountId);
      if (!acc || !isCashOrBank(acc)) continue;
      bankNetByEntry.set(
        l.journalEntryId,
        (bankNetByEntry.get(l.journalEntryId) || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0),
      );
    }
  }

  let changed = 0;
  let skipped = 0;
  const samples: string[] = [];
  for (const e of entries) {
    const ref = String(e.reference || '').trim();
    if (!ref) continue;
    const srcType = e.sourceDocumentId ? docTypeById.get(e.sourceDocumentId) : undefined;
    let next = ref;
    if (srcType === 'MANUAL_OFFSET') {
      skipped++;
      continue;
    } else if (srcType === 'OFFICIAL_RECEIPT') {
      next = refWith('REC', ref);
    } else if (srcType && e.type === 'PAYMENT') {
      next = refWith('REC', ref);
    } else if (srcType) {
      next = docRef(srcType, ref);
    } else if (e.type === 'BILL') {
      next = refWith('SIN', ref);
    } else if (e.type === 'PAYMENT' && (e.description || '').startsWith('Payment voucher')) {
      next = refWith('P/V', ref);
    } else if (e.type === 'PAYMENT' && (e.description || '').startsWith('Auto-posted from payment')) {
      next = refWith('REC', ref);
    } else if (['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PURCHASE_ORDER', 'PURCHASE_RETURN'].includes(e.type)) {
      // Xero-imported document journals carry no sourceDocumentId — the JE
      // type IS the document type, so prefix by it (INV / C/N / D/N / PO / PR).
      next = docRef(e.type, ref);
    } else if (e.type === 'PAYMENT') {
      // Bank-line direction decides: money in → REC, money out → P/V.
      const bankNet = bankNetByEntry.get(e.id);
      if (bankNet === undefined || Math.abs(bankNet) < 0.005) {
        skipped++; // no bank line found — leave untouched
        continue;
      }
      next = refWith(bankNet > 0 ? 'REC' : 'P/V', ref);
    } else {
      // MANUAL journals keep their free-text reference (J/V is applied at
      // display time from the journal number).
      skipped++;
      continue;
    }
    if (next === ref) {
      skipped++;
      continue;
    }
    changed++;
    if (samples.length < 15) samples.push(`  ${e.type.padEnd(16)} ${ref}  ->  ${next}`);
    if (APPLY) {
      await p.journalEntry.update({ where: { id: e.id }, data: { reference: next } });
    }
  }

  console.log(`\n${APPLY ? 'UPDATED' : 'WOULD UPDATE'}: ${changed}   unchanged/skipped: ${skipped}`);
  console.log('Samples:');
  for (const s of samples) console.log(s);
  if (!APPLY) console.log('\nDry run — re-run with --apply to write.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
