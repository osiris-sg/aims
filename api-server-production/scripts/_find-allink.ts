import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true });
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const bank = await p.chartOfAccount.findFirst({ where: { organizationId: ORG, code: '102' }, select: { id: true } });
  // journal lines crediting 1277.48 on bank 102, Apr-Jun 2026
  const jls = await p.journalEntryLine.findMany({
    where: { accountId: bank!.id, credit: { gte: 1277.47, lte: 1277.49 }, journalEntry: { organizationId: ORG, entryDate: { gte: new Date('2026-04-01'), lte: new Date('2026-06-30') } } },
    include: { journalEntry: { select: { id: true, journalNumber: true, entryDate: true, reference: true, description: true, status: true } } },
  });
  console.log(`bank-102 credit 1277.48 lines (Apr–Jun): ${jls.length}`);
  for (const l of jls) {
    const je = l.journalEntry;
    const bp = await p.billPayment.findFirst({ where: { journalEntryId: je.id }, include: { supplier: { select: { name: true } } } });
    const claimed = await p.bankStatementMatch.findFirst({ where: { journalLineId: l.id } });
    const claimedLegacy = await p.bankStatementLine.findFirst({ where: { matchedJournalLineId: l.id }, select: { description: true, date: true, amount: true } });
    console.log(`  ${je.journalNumber} ${je.entryDate.toISOString().slice(0,10)} [${je.status}] ref="${je.reference}" desc="${(je.description||'').slice(0,40)}"`);
    console.log(`    billPayment: ${bp ? `${bp.supplier?.name} (${bp.reference || 'no ref'})` : 'NOT LINKED'}`);
    if (claimed) {
      const line = await p.bankStatementLine.findUnique({ where: { id: claimed.lineId }, select: { description: true, date: true, amount: true } });
      console.log(`    CLAIMED by match-row → stmt "${line?.description?.slice(0,50)}" ${line?.date.toISOString().slice(0,10)} ${line?.amount}`);
    }
    if (claimedLegacy) console.log(`    CLAIMED legacy → stmt "${claimedLegacy.description?.slice(0,50)}" ${claimedLegacy.amount}`);
    if (!claimed && !claimedLegacy) console.log('    not claimed by any statement line');
  }
  // also all Allink bill payments around May
  const allink = await p.billPayment.findMany({ where: { organizationId: ORG, supplier: { name: { contains: 'llink' } } }, include: { supplier: { select: { name: true } } }, orderBy: { paymentDate: 'asc' } });
  console.log(`\nAllink BillPayments: ${allink.length}`);
  for (const b of allink) console.log(`  ${b.paymentDate.toISOString().slice(0,10)} $${b.amount} ref=${b.reference || '-'} je=${b.journalEntryId ? 'linked' : 'NOT LINKED'}`);
}
main().finally(() => p.$disconnect());
