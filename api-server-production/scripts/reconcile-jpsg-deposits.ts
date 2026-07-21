/** Post reconciling journals so every AIMS Customer Deposit balance ties
 *  exactly to JPSG companies.credit_balance (the proven source of truth —
 *  diverted transactions & consolidated-invoice payments mutate balance
 *  outside the plain ledger). Idempotent: reference JPSGREC:<companyId>.
 *  Rerunnable after future imports — posts only the residual delta. */
import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
import { Client } from 'pg';
import * as fs from 'fs';
const prisma = createScriptPrisma();
const jpsgUrl = fs.readFileSync('.env', 'utf8').match(/^JPSG_DATABASE=\s*(.+)$/m)![1].trim();
const R = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const CAUSE: Record<string, string> = {
  '0e2ef863': '10 diverted-in transactions ($3,047.82) charged to origin company — balance not deducted from SMM',
  '1d001809': 'consolidated-invoice-paid disposals (22 invoices) settle outside the wallet ledger',
  'c3cc362e': 'pool/diversion mechanics — balance maintained outside plain ledger',
  '536c63e6': 'test-account balance edit outside ledger',
};
async function main() {
  const jpsg = new Client({ connectionString: jpsgUrl });
  await jpsg.connect();
  const companies = (await jpsg.query(`SELECT id, name, credit_balance::float AS bal FROM companies`)).rows as Array<{ id: string; name: string; bal: number }>;
  await jpsg.end();
  const adjClr = await prisma.chartOfAccount.findFirst({ where: { organizationId: BIOFUEL_ORG_ID, code: { startsWith: 'JPADJ' } } });
  if (!adjClr) throw new Error('JPADJ clearing account missing');
  let posted = 0, clean = 0;
  let jn = await prisma.journalEntry.count({ where: { organizationId: BIOFUEL_ORG_ID, journalNumber: { startsWith: 'JV-JPSGR-' } } });
  for (const co of companies) {
    const acct = await prisma.chartOfAccount.findFirst({ where: { organizationId: BIOFUEL_ORG_ID, name: `Customer Deposit-${co.name}` } });
    if (!acct) continue;
    const g = await prisma.journalEntryLine.aggregate({ where: { accountId: acct.id, journalEntry: { organizationId: BIOFUEL_ORG_ID, status: 'POSTED' } }, _sum: { debit: true, credit: true } });
    const aims = R((g._sum.credit || 0) - (g._sum.debit || 0));
    const delta = R(co.bal - aims); // positive → need to CREDIT deposit more
    if (Math.abs(delta) < 0.01) { clean++; continue; }
    const cause = CAUSE[co.id.slice(0, 8)] || 'JPSG balance maintained outside plain ledger (diversion/consolidation mechanics)';
    const desc = `JPSG reconciliation ${co.name}: align to credit_balance ${co.bal.toFixed(2)} (Δ ${delta.toFixed(2)}) — ${cause}`;
    const amt = Math.abs(delta);
    const lines = delta > 0
      ? [
          { accountId: adjClr.id, lineNumber: 1, description: desc, debit: amt, credit: 0 },
          { accountId: acct.id, lineNumber: 2, description: desc, debit: 0, credit: amt },
        ]
      : [
          { accountId: acct.id, lineNumber: 1, description: desc, debit: amt, credit: 0 },
          { accountId: adjClr.id, lineNumber: 2, description: desc, debit: 0, credit: amt },
        ];
    jn++;
    await prisma.journalEntry.create({
      data: {
        organizationId: BIOFUEL_ORG_ID, journalNumber: `JV-JPSGR-${String(jn).padStart(4, '0')}`,
        entryDate: new Date(), type: 'ADJUSTMENT', status: 'POSTED',
        reference: `JPSGREC:${co.id}:${Date.now()}`, description: desc,
        totalDebit: amt, totalCredit: amt, currency: 'SGD',
        postedAt: new Date(), postedBy: 'jpsg-reconcile', createdBy: 'jpsg-reconcile',
        lines: { create: lines },
      },
    });
    console.log(`  ± ${co.name.slice(0, 40).padEnd(40)} Δ ${delta.toFixed(2)} posted`);
    posted++;
  }
  console.log(`\nposted=${posted} already-clean=${clean}`);
  // final verify
  const jpsg2 = new Client({ connectionString: jpsgUrl });
  await jpsg2.connect();
  const cos = (await jpsg2.query(`SELECT id, name, credit_balance::float AS bal FROM companies`)).rows as any[];
  await jpsg2.end();
  let ok = 0, off = 0;
  for (const co of cos) {
    const acct = await prisma.chartOfAccount.findFirst({ where: { organizationId: BIOFUEL_ORG_ID, name: `Customer Deposit-${co.name}` } });
    if (!acct) continue;
    const g = await prisma.journalEntryLine.aggregate({ where: { accountId: acct.id, journalEntry: { organizationId: BIOFUEL_ORG_ID, status: 'POSTED' } }, _sum: { debit: true, credit: true } });
    const aims = R((g._sum.credit || 0) - (g._sum.debit || 0));
    if (Math.abs(aims - co.bal) < 0.01) ok++;
    else { off++; console.log(`  ✗ ${co.name}: AIMS ${aims} vs JPSG ${co.bal}`); }
  }
  console.log(`FINAL: ${ok} tie to the cent, ${off} off`);
}
main().catch(e => { console.error('FATAL', e?.message || e); process.exit(1); }).finally(() => prisma.$disconnect());
