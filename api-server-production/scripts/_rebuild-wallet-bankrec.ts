/** After the Xero-imported top-up journals become canonical: rebuild the
 *  Airwallex bank statement + match lines to the IMPORTED (JV-XERO) wallet
 *  journal lines by date+amount. */
import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
import * as fs from 'fs';
const p = createScriptPrisma();
const SP = '/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/6e733d78-df86-4e60-8e0d-938d4a93fe47/scratchpad';
const R = (n: number) => Math.round(n * 100) / 100;
async function main() {
  const wallet = await p.chartOfAccount.findFirst({ where: { organizationId: BIOFUEL_ORG_ID, name: 'Airwallex' } });
  if (!wallet) throw new Error('no wallet account');
  // wipe old statement
  const olds = await p.bankStatementImport.findMany({ where: { organizationId: BIOFUEL_ORG_ID, bankAccountId: wallet.id }, select: { id: true } });
  await p.bankStatementLine.deleteMany({ where: { importId: { in: olds.map(o => o.id) } } });
  await p.bankStatementImport.deleteMany({ where: { id: { in: olds.map(o => o.id) } } });
  // candidate journal lines on wallet (xero-imported)
  const jls = await p.journalEntryLine.findMany({
    where: { accountId: wallet.id, journalEntry: { organizationId: BIOFUEL_ORG_ID, status: 'POSTED', postedBy: 'xero-import' } },
    select: { id: true, debit: true, credit: true, journalEntry: { select: { entryDate: true } } },
  });
  const used = new Set<string>();
  const txns: any[] = JSON.parse(fs.readFileSync(`${SP}/airwallex-txns.json`, 'utf8'));
  const settled = txns.filter(t => t.status === 'Settled').sort((a, b) => +new Date(a.settled || a.created) - +new Date(b.settled || b.created));
  const imp = await p.bankStatementImport.create({
    data: {
      organizationId: BIOFUEL_ORG_ID, bankAccountId: wallet.id, source: 'CSV',
      filename: 'Transaction_Reconciliation_Report_2026-07-20.xlsx',
      periodStart: new Date(settled[0].settled || settled[0].created),
      periodEnd: new Date(settled[settled.length - 1].settled || settled[settled.length - 1].created),
      endingBalance: R(settled.reduce((s, t) => s + t.net, 0)),
      createdBy: 'awx-rebuild',
    },
  });
  let bal = 0, matched = 0;
  for (const t of settled) {
    bal = R(bal + t.net);
    const day = (t.settled || t.created).slice(0, 10);
    const hit = jls.find(l => {
      if (used.has(l.id)) return false;
      const amt = R((l.debit || 0) - (l.credit || 0));
      if (Math.abs(amt - R(t.net)) > 0.005) return false;
      const jd = l.journalEntry.entryDate.toISOString().slice(0, 10);
      return Math.abs(+new Date(jd) - +new Date(day)) <= 4 * 864e5;
    });
    if (hit) used.add(hit.id);
    await p.bankStatementLine.create({
      data: {
        importId: imp.id, organizationId: BIOFUEL_ORG_ID, bankAccountId: wallet.id,
        date: new Date((t.settled || t.created).replace(' ', 'T') + '+08:00'),
        description: t.type === 'Payout' ? 'Sweep to UOB' : t.amount === 0 ? 'PayNow failed-attempt fee' : `PayNow top-up (${(t.baseTopupId || '').slice(6, 14)}…)`,
        reference: t.ftxId, amount: R(t.net), runningBalance: bal,
        status: hit ? 'MATCHED' : 'PENDING',
        matchedJournalLineId: hit?.id || null, matchedAt: hit ? new Date() : null, matchedBy: hit ? 'awx-rebuild' : null,
      },
    });
    if (hit) matched++;
  }
  console.log(`bank statement rebuilt: ${settled.length} lines, matched=${matched}, ending=${bal.toFixed(2)}`);
}
main().catch(e => { console.error('FATAL', e?.message || e); process.exit(1); }).finally(() => p.$disconnect());
