/** Wipe AWX journals + wallet bank statement so the import can rebuild cleanly. */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const envFile = process.argv.find(a => a.startsWith('--env='))?.split('=')[1] || '.env';
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const url = new URL(m[1]); url.searchParams.delete('pool_timeout'); url.searchParams.delete('connect_timeout');
const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url.toString() }) } as any);
async function main() {
  const jes = await p.journalEntry.findMany({ where: { organizationId: ORG, reference: { startsWith: 'AWX:' } }, select: { id: true } });
  const ids = jes.map(j => j.id);
  await p.journalEntryLine.deleteMany({ where: { journalEntryId: { in: ids } } });
  await p.journalEntry.deleteMany({ where: { id: { in: ids } } });
  const imps = await p.bankStatementImport.findMany({ where: { organizationId: ORG, filename: 'Transaction_Reconciliation_Report_2026-07-20.xlsx' }, select: { id: true } });
  await p.bankStatementLine.deleteMany({ where: { importId: { in: imps.map(i => i.id) } } });
  await p.bankStatementImport.deleteMany({ where: { id: { in: imps.map(i => i.id) } } });
  console.log(`wiped ${ids.length} AWX journals + ${imps.length} statement import(s)`);
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
