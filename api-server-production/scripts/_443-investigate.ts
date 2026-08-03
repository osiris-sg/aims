import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
async function main() {
  const acct = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, code: '443' }, select: { id: true, name: true } });
  if (!acct) throw new Error('no 443');
  const lines = await prisma.journalEntryLine.findMany({
    where: { accountId: acct.id, journalEntry: { organizationId: ORG, status: 'POSTED' } },
    include: { journalEntry: { select: { journalNumber: true, reference: true, description: true, entryDate: true, type: true } } },
  });
  let dr = 0, cr = 0;
  for (const l of lines) { dr += l.debit; cr += l.credit; }
  console.log(`AIMS GL 443 "${acct.name}": ${lines.length} lines, DR ${dr.toFixed(2)}, CR ${cr.toFixed(2)}, NET ${(dr - cr).toFixed(2)}`);
  for (const l of lines.slice(0, 60)) {
    const j = l.journalEntry;
    console.log(`  ${j.entryDate.toISOString().slice(0,10)} ${j.journalNumber} [${j.type}] ref="${j.reference}" D${l.debit} C${l.credit} :: ${(l.description || j.description || '').slice(0, 60)}`);
  }
  if (lines.length > 60) console.log(`  ...and ${lines.length - 60} more`);
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
