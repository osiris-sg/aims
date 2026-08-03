import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true });
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const lines = await p.bankStatementLine.findMany({
    where: { organizationId: ORG, status: 'MATCHED', matchedBy: null, matchedJournalLineId: null },
    include: { matches: true },
  });
  const bad = lines.filter((l) => l.matches.length > 1);
  console.log(`auto batch-matched lines: ${bad.length}`);
  for (const l of bad) {
    await p.bankStatementMatch.deleteMany({ where: { lineId: l.id } });
    await p.bankStatementLine.update({ where: { id: l.id }, data: { status: 'PENDING', matchedAt: null } });
    console.log(`  reset ${l.date.toISOString().slice(0,10)} ${l.amount} :: ${(l.description||'').slice(0,50)}`);
  }
}
main().finally(() => p.$disconnect());
