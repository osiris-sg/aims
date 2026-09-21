import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m = fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: m[1] }) } as any);
const ORG = 'e847c8c0-5063-48be-a1d9-28f9f694716d';
async function main() {
  const je = await prisma.journalEntry.count({ where: { organizationId: ORG } });
  const jel = await prisma.journalEntryLine.aggregate({
    where: { journalEntry: { organizationId: ORG } }, _sum: { debit: true, credit: true }, _count: true,
  });
  const docs = await prisma.document.count({ where: { organizationId: ORG } });
  const coa = await prisma.chartOfAccount.groupBy({ by: ['accountType'], where: { organizationId: ORG }, _count: true });
  const pending = await prisma.bankStatementLine.groupBy({ by: ['status'], where: { organizationId: ORG }, _count: true });
  console.log('JournalEntries:', je, ' lines:', jel._count, ' Dr:', jel._sum.debit ?? 0, ' Cr:', jel._sum.credit ?? 0);
  console.log('Documents:', docs);
  console.log('Recon lines by status:', pending.map((p: any) => `${p.status}=${p._count}`).join(', ') || 'none');
  console.log('CoA by type:', coa.map((c: any) => `${c.accountType}=${c._count}`).join(', '));
}
main().catch(console.error).finally(() => prisma.$disconnect());
