import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true });
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
async function main() {
  const imp = await p.bankStatementImport.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { lines: true },
  });
  if (!imp) return console.log('none');
  console.log(`import ${imp.filename} status=${imp.status} err=${imp.error || '-'} period=${imp.periodStart?.toISOString().slice(0,10)}→${imp.periodEnd?.toISOString().slice(0,10)} ending=${imp.endingBalance}`);
  const by = (st: string) => imp.lines.filter((l) => l.status === st);
  console.log(`lines=${imp.lines.length} PENDING=${by('PENDING').length} MATCHED=${by('MATCHED').length} POSTED_NEW=${by('POSTED_NEW').length} IGNORED=${by('IGNORED').length}`);
  const inSum = imp.lines.filter(l=>l.amount>0).reduce((s,l)=>s+l.amount,0);
  const outSum = imp.lines.filter(l=>l.amount<0).reduce((s,l)=>s+l.amount,0);
  console.log(`money in=${inSum.toFixed(2)} money out=${outSum.toFixed(2)}`);
  console.log('\nsample PENDING lines:');
  for (const l of by('PENDING').slice(0, 12)) console.log(`  ${l.date.toISOString().slice(0,10)} ${String(l.amount).padStart(12)} :: ${l.description.slice(0, 70)}`);
  console.log('\nsample MATCHED lines:');
  for (const l of by('MATCHED').slice(0, 5)) console.log(`  ${l.date.toISOString().slice(0,10)} ${String(l.amount).padStart(12)} :: ${l.description.slice(0, 60)}`);
}
main().finally(() => p.$disconnect());
