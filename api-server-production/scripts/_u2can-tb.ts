import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m = fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG = '9d70bb56-3774-48c6-9adf-8ea62e7d1ab2';
async function main() {
  const je = await prisma.journalEntry.count({ where: { organizationId: ORG, status: 'POSTED' } });
  const agg = await prisma.journalEntryLine.aggregate({ where: { journalEntry: { organizationId: ORG, status: 'POSTED' } }, _sum: { debit: true, credit: true } });
  console.log(`POSTED entries: ${je}  Dr ${agg._sum.debit}  Cr ${agg._sum.credit}  diff ${(agg._sum.debit||0)-(agg._sum.credit||0)}`);
  const lines = await prisma.journalEntryLine.groupBy({ by: ['accountId'], where: { journalEntry: { organizationId: ORG, status: 'POSTED' } }, _sum: { debit: true, credit: true } });
  const accts = await prisma.chartOfAccount.findMany({ where: { organizationId: ORG }, select: { id: true, code: true, name: true, category: true } });
  const byId = new Map(accts.map((a: any) => [a.id, a]));
  let rev = 0, exp = 0;
  for (const l of lines as any[]) {
    const a = byId.get(l.accountId) as any;
    const bal = (l._sum.debit || 0) - (l._sum.credit || 0);
    if (a.category === 'PNL') { if (bal < 0) rev -= bal; else exp += bal; }
  }
  console.log(`P&L: income ${rev.toFixed(2)}  costs ${exp.toFixed(2)}  net ${(rev-exp).toFixed(2)}`);
  const range = await prisma.journalEntry.aggregate({ where: { organizationId: ORG }, _min: { entryDate: true }, _max: { entryDate: true } });
  console.log(`JE date range: ${range._min.entryDate?.toISOString().slice(0,10)} -> ${range._max.entryDate?.toISOString().slice(0,10)}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
