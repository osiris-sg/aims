/**
 * Total RENTAL revenue billed in a period, straight from the ledger.
 * (guru 2026-11-05: "the total rental revenue of all items billed in oct".)
 *
 * READ-ONLY — nothing but SELECTs.
 *
 * This reads the GL, not the invoice text, so it needs no guessing about how a
 * line was worded: revenue is whatever was POSTED to an income account whose
 * name says Rental, credits less debits (so a credit note reduces the month).
 * That is the same figure the P&L shows for those accounts.
 *
 * Usage (dev):
 *   TENANCY_MODE= npx ts-node --transpile-only scripts/rental-revenue.ts \
 *     --from=2026-10-01 --to=2026-11-01 --schema=org_biofuel
 *
 * Usage (prod — schema is public):
 *   ./node_modules/.bin/dotenv -e .env.production -- \
 *     npx ts-node --transpile-only scripts/rental-revenue.ts \
 *     --from=2026-10-01 --to=2026-11-01 --schema=public
 *
 * --all-income totals EVERY income account, with the rental ones marked, so the
 *   rental share of the month is visible in one go.
 */
import { createScriptPrisma } from './xero-migration/_common';
const prisma = createScriptPrisma();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d);

const SCHEMA = arg('schema', 'org_biofuel');
const FROM = arg('from', '2026-10-01');
const TO = arg('to', '2026-11-01');
const ALL_INCOME = process.argv.includes('--all-income');
/** The other half of the question (guru 2026-11-05: "how much i earn from
 *  sales not rental in october") — every income account whose name does NOT
 *  say Rental: sales of units, transport, servicing, manpower and the rest. */
const SALES_ONLY = process.argv.includes('--sales');
const m = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT a.code, a.name, a."accountType",
            SUM(l.credit - l.debit)::float AS revenue,
            COUNT(*)::int AS lines
       FROM "${SCHEMA}"."JournalEntryLine" l
       JOIN "${SCHEMA}"."JournalEntry"   j ON j.id = l."journalEntryId"
       JOIN "${SCHEMA}"."ChartOfAccount" a ON a.id = l."accountId"
      WHERE j.status = 'POSTED'
        AND j."entryDate" >= $1::timestamp AND j."entryDate" < $2::timestamp
        AND a.category = 'PNL' AND a."normalBalance" = 'CREDIT'
      GROUP BY a.code, a.name, a."accountType"
      ORDER BY a.code`, FROM, TO);

  const isRental = (n: string) => /rental/i.test(n);
  const shown = ALL_INCOME ? rows : rows.filter((r) => (SALES_ONLY ? !isRental(r.name) : isRental(r.name)));

  const heading = ALL_INCOME ? 'Income' : SALES_ONLY ? 'Non-rental income (sales, transport, servicing…)' : 'Rental revenue';
  console.log(`\n${heading} billed ${FROM} → ${TO}   [schema ${SCHEMA}]`);
  console.log(`(POSTED journals only; credits less debits, so credit notes reduce the month)\n`);
  console.log(`  ${'Code'.padEnd(8)}${'Account'.padEnd(46)}${'Lines'.padStart(8)}${'Revenue'.padStart(18)}`);
  console.log(`  ${'-'.repeat(80)}`);
  let rentalTotal = 0, allTotal = 0;
  for (const r of rows) {
    allTotal += r.revenue;
    if (isRental(r.name)) rentalTotal += r.revenue;
    if (!shown.includes(r)) continue;
    const mark = ALL_INCOME && isRental(r.name) ? ' ←rental' : '';
    console.log(`  ${String(r.code).padEnd(8)}${String(r.name).slice(0, 44).padEnd(46)}${String(r.lines).padStart(8)}${m(r.revenue).padStart(18)}${mark}`);
  }
  console.log(`  ${'-'.repeat(80)}`);
  // Always print BOTH halves and the whole, whichever half was asked for: the
  // interesting number is usually the split, not one side of it.
  const salesTotal = allTotal - rentalTotal;
  console.log(`  ${'RENTAL'.padEnd(54)}${''.padStart(8)}${m(rentalTotal).padStart(18)}`);
  console.log(`  ${'NON-RENTAL (sales, transport, servicing…)'.padEnd(54)}${''.padStart(8)}${m(salesTotal).padStart(18)}`);
  console.log(`  ${'ALL INCOME'.padEnd(54)}${''.padStart(8)}${m(allTotal).padStart(18)}`);
  console.log(`  ${'rental share'.padEnd(54)}${''.padStart(8)}${(allTotal ? (100 * rentalTotal / allTotal).toFixed(1) : '0.0').padStart(17)}%`);
  // CROSS-CHECK from the other side: the invoices themselves. The two should
  // agree; when they don't, something was posted by hand or an invoice never
  // reached the ledger, and the gap is the thing worth looking at.
  const inv: any[] = await prisma.$queryRawUnsafe(
    `SELECT name, type, status, config FROM "${SCHEMA}"."Document"
      WHERE type IN ('INVOICE', 'CREDIT_NOTE') AND config->>'date' >= $1 AND config->>'date' < $2`, FROM, TO);
  const coa: any[] = await prisma.$queryRawUnsafe(`SELECT code, name FROM "${SCHEMA}"."ChartOfAccount"`);
  // Cross-check the side that was asked for.
  const sideCodes = new Set(
    rows.filter((r: any) => (SALES_ONLY ? !isRental(r.name) : isRental(r.name))).map((r: any) => String(r.code)),
  );
  const rentalCodes = sideCodes;
  const sideTotal = SALES_ONLY ? salesTotal : rentalTotal;
  const ISSUED = new Set(['paid', 'pending_payment', 'confirmed', 'partially_paid', 'overdue']);
  let invTotal = 0, invCount = 0, cnTotal = 0, cnCount = 0, skippedDraft = 0;
  for (const d of inv) {
    const c: any = d.config || {};
    if (c.voided === true || String(c.xeroStatus).toUpperCase() === 'VOIDED' || String(d.status).toLowerCase() === 'void') continue;
    if (!ISSUED.has(String(d.status).toLowerCase())) { skippedDraft++; continue; }
    let t = 0;
    for (const it of c.items || []) if (it.accountCode && rentalCodes.has(String(it.accountCode))) t += Number(it.amount) || 0;
    if (!t) continue;
    if (d.type === 'CREDIT_NOTE') { cnTotal += t; cnCount++; } else { invTotal += t; invCount++; }
  }
  const docSide = invTotal - cnTotal;
  const gap = sideTotal - docSide;
  console.log(`\n  Cross-check — the same period from the documents instead:`);
  console.log(`    invoices  (${String(invCount).padStart(4)} issued)     ${m(invTotal).padStart(16)}${skippedDraft ? `   (${skippedDraft} draft/unconfirmed skipped)` : ''}`);
  console.log(`    less credit notes (${String(cnCount).padStart(3)})     ${m(-cnTotal).padStart(16)}`);
  console.log(`    documents, net              ${m(docSide).padStart(16)}`);
  console.log(`    ${`ledger (${SALES_ONLY ? 'non-rental' : 'rental'})`.padEnd(28)}${m(sideTotal).padStart(16)}`);
  console.log(`    difference                  ${m(gap).padStart(16)}  ${Math.abs(gap) < 0.01 ? '✓ agree' : '← manual journals, or a document that never reached the ledger. Run with --journals to see them.'}`);

  if (process.argv.includes('--journals')) {
    const manual: any[] = await prisma.$queryRawUnsafe(
      `SELECT j."journalNumber", j.reference, j."createdBy", a.code,
              SUM(l.credit - l.debit)::float AS rev
         FROM "${SCHEMA}"."JournalEntryLine" l
         JOIN "${SCHEMA}"."JournalEntry"   j ON j.id = l."journalEntryId"
         JOIN "${SCHEMA}"."ChartOfAccount" a ON a.id = l."accountId"
        WHERE j.status = 'POSTED' AND j."sourceDocumentId" IS NULL
          AND j."entryDate" >= $1::timestamp AND j."entryDate" < $2::timestamp
          AND a.category = 'PNL' AND a."normalBalance" = 'CREDIT'
          AND a.name ${SALES_ONLY ? 'NOT ILIKE' : 'ILIKE'} '%rental%'
        GROUP BY 1,2,3,4 ORDER BY ABS(SUM(l.credit - l.debit)) DESC LIMIT 25`, FROM, TO);
    console.log(`\n  Journals on rental accounts with no source document (${manual.length}):`);
    for (const j of manual)
      console.log(`    ${String(j.journalNumber).padEnd(16)} ${String(j.code).padEnd(5)} ${String(j.reference ?? '').slice(0, 30).padEnd(32)} ${m(Number(j.rev)).padStart(14)}  ${j.createdBy}`);
  }
  console.log('\n  Figures exclude GST (tax posts to its own liability account).\n');
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
