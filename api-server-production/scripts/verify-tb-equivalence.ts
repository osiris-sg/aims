import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const ROUND = (n: number) => Math.round(n * 100) / 100;
const now = new Date();

async function main() {
  const where: any = { organizationId: ORG, status: 'POSTED', entryDate: { lte: now } };

  // OLD: pull all lines + account, reduce in JS
  const lines = await p.journalEntryLine.findMany({ where: { journalEntry: where }, include: { account: true } });
  const oldMap = new Map<string, { code: string; nb: string; debit: number; credit: number }>();
  for (const l of lines) {
    const a = l.account;
    const e = oldMap.get(a.id) ?? { code: a.code, nb: a.normalBalance, debit: 0, credit: 0 };
    e.debit += l.debit; e.credit += l.credit; oldMap.set(a.id, e);
  }
  const oldRows = new Map<string, number>();
  for (const [id, r] of oldMap) {
    const d = ROUND(r.debit), c = ROUND(r.credit);
    oldRows.set(id, ROUND(r.nb === 'DEBIT' ? d - c : c - d));
  }

  // NEW: groupBy + accounts
  const grouped = await p.journalEntryLine.groupBy({ by: ['accountId'], where: { journalEntry: where }, _sum: { debit: true, credit: true } });
  const accounts = await p.chartOfAccount.findMany({ where: { organizationId: ORG }, select: { id: true, normalBalance: true } });
  const acctById = new Map(accounts.map((a) => [a.id, a]));
  const newRows = new Map<string, number>();
  for (const g of grouped) {
    const a = acctById.get(g.accountId); if (!a) continue;
    const d = ROUND(g._sum.debit ?? 0), c = ROUND(g._sum.credit ?? 0);
    newRows.set(g.accountId, ROUND(a.normalBalance === 'DEBIT' ? d - c : c - d));
  }

  // Compare
  let mismatches = 0;
  const allIds = new Set([...oldRows.keys(), ...newRows.keys()]);
  for (const id of allIds) {
    const o = oldRows.get(id) ?? 0, n = newRows.get(id) ?? 0;
    if (o !== n) { mismatches++; console.log(`  MISMATCH acct=${id}: old=${o} new=${n}`); }
  }
  const oldTotal = ROUND([...oldRows.values()].reduce((s, v) => s + v, 0));
  const newTotal = ROUND([...newRows.values()].reduce((s, v) => s + v, 0));
  console.log(`Accounts: old=${oldRows.size} new=${newRows.size}`);
  console.log(`Sum of balances: old=${oldTotal} new=${newTotal}`);
  console.log(mismatches === 0 ? '✅ IDENTICAL — new groupBy matches old line-by-line exactly' : `*** ${mismatches} MISMATCHES ***`);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => p.$disconnect());
