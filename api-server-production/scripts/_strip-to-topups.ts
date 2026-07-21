/** Reduce dev to TOP-UPS ONLY: delete JPSG ledger journals (JV-JPSG-*) and
 *  reconciling entries (JV-JPSGR-*), drop now-empty JPSG-only accounts.
 *  Keeps: JV-AWX-* journals, wallet/fees accounts, funded deposit accounts,
 *  bank statement (matches AWX lines only). */
import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
const p = createScriptPrisma();
async function main() {
  const jes = await p.journalEntry.findMany({
    where: { organizationId: BIOFUEL_ORG_ID, OR: [{ reference: { startsWith: 'JPSG:' } }, { reference: { startsWith: 'JPSGREC:' } }] },
    select: { id: true },
  });
  const ids = jes.map(j => j.id);
  await p.journalEntryLine.deleteMany({ where: { journalEntryId: { in: ids } } });
  await p.journalEntry.deleteMany({ where: { id: { in: ids } } });
  console.log(`removed ${ids.length} JPSG journals`);
  // drop accounts that now have zero lines and came from the JPSG phase
  const candidates = await p.chartOfAccount.findMany({
    where: { organizationId: BIOFUEL_ORG_ID, OR: [
      { code: { startsWith: 'CD' } }, { code: { startsWith: 'AWXH' } }, { code: { startsWith: 'MTC' } }, { code: { startsWith: 'JPADJ' } }, { code: { startsWith: 'REV-JPSG' } },
    ] },
    select: { id: true, code: true, name: true },
  });
  let dropped = 0;
  for (const a of candidates) {
    if (a.code === 'CD000') continue; // keep control parent
    const n = await p.journalEntryLine.count({ where: { accountId: a.id } });
    const kids = await p.chartOfAccount.count({ where: { parentAccountId: a.id } });
    if (n === 0 && kids === 0) { await p.chartOfAccount.delete({ where: { id: a.id } }); dropped++; }
  }
  console.log(`dropped ${dropped} empty JPSG-phase accounts`);
  // verify topup-only state
  const wallet = await p.chartOfAccount.findFirst({ where: { organizationId: BIOFUEL_ORG_ID, name: 'Airwallex' } });
  const g = await p.journalEntryLine.aggregate({ where: { accountId: wallet!.id, journalEntry: { organizationId: BIOFUEL_ORG_ID, status: 'POSTED' } }, _sum: { debit: true, credit: true } });
  console.log(`wallet balance: ${((g._sum.debit || 0) - (g._sum.credit || 0)).toFixed(2)} (expect 13,308.00)`);
  const deps = await p.chartOfAccount.findMany({ where: { organizationId: BIOFUEL_ORG_ID, name: { startsWith: 'Customer Deposit-' } }, select: { id: true, name: true } });
  let total = 0;
  for (const d of deps) {
    const s = await p.journalEntryLine.aggregate({ where: { accountId: d.id, journalEntry: { organizationId: BIOFUEL_ORG_ID, status: 'POSTED' } }, _sum: { debit: true, credit: true } });
    const bal = (s._sum.credit || 0) - (s._sum.debit || 0);
    total += bal;
    if (bal > 0.005) console.log(`  ${d.name.slice(0, 55).padEnd(55)} ${bal.toFixed(2)}`);
  }
  console.log(`Σ deposits funded: ${total.toFixed(2)} (expect 195,720 = 196,120 gross − 400 pending)`);
}
main().catch(e => { console.error('FATAL', e?.message || e); process.exit(1); }).finally(() => p.$disconnect());
