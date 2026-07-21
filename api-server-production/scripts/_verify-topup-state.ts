import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
const p = createScriptPrisma();
const R = (n: number) => Math.round(n * 100) / 100;
async function main() {
  const awx = await p.journalEntry.groupBy({ by: ['status'], where: { organizationId: BIOFUEL_ORG_ID, reference: { startsWith: 'AWX:' } }, _count: true });
  console.log('AWX journals:', JSON.stringify(awx));
  const kinds = await p.$queryRawUnsafe<any[]>(`
    SELECT CASE WHEN description LIKE 'PayNow top-up%' THEN 'top-up'
                WHEN description LIKE '%failed-attempt%' THEN 'failed-fee'
                ELSE 'sweep' END AS kind, count(*)::int AS n, sum("totalDebit")::numeric(14,2) AS total
    FROM "JournalEntry" WHERE "organizationId" = $1 AND reference LIKE 'AWX:%' GROUP BY 1`, BIOFUEL_ORG_ID);
  console.table(kinds);
  const bal = async (name: string) => {
    const a = await p.chartOfAccount.findFirst({ where: { organizationId: BIOFUEL_ORG_ID, name } });
    if (!a) return null;
    const g = await p.journalEntryLine.aggregate({ where: { accountId: a.id, journalEntry: { organizationId: BIOFUEL_ORG_ID, status: 'POSTED' } }, _sum: { debit: true, credit: true } });
    return R((g._sum.debit || 0) - (g._sum.credit || 0));
  };
  console.log('Airwallex wallet:', await bal('Airwallex'), '(13,308.00 = ours; +5,000 if Xero test transfer still present)');
  console.log('Airwallex Fees :', await bal('Airwallex Fees'));
  const deps = await p.chartOfAccount.findMany({ where: { organizationId: BIOFUEL_ORG_ID, name: { startsWith: 'Customer Deposit-' } }, select: { id: true, name: true } });
  let tot = 0, nonzero = 0;
  for (const d of deps) {
    const g = await p.journalEntryLine.aggregate({ where: { accountId: d.id, journalEntry: { organizationId: BIOFUEL_ORG_ID, status: 'POSTED' } }, _sum: { debit: true, credit: true } });
    const b = R((g._sum.credit || 0) - (g._sum.debit || 0));
    if (Math.abs(b) > 0.005) nonzero++;
    tot = R(tot + b);
  }
  console.log(`deposit accounts: ${deps.length} (${nonzero} funded)  Σ = ${tot.toFixed(2)}`);
  const stmt = await p.bankStatementLine.groupBy({ by: ['status'], where: { organizationId: BIOFUEL_ORG_ID }, _count: true });
  console.log('bank statement lines:', JSON.stringify(stmt));
}
main().catch(e => { console.error('FATAL', e?.message || e); process.exit(1); }).finally(() => p.$disconnect());
