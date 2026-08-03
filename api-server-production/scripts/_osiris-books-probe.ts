import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

const envFile = process.argv[2] || '.env';
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);

async function main() {
  console.log(`\n================ ${envFile} ================`);
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log('ORGS:', orgs.map((o) => `${o.name} [${o.id}]`).join('\n      '));

  const osiris = orgs.find((o) => /osiris tech/i.test(o.name)) || orgs.find((o) => /osiris/i.test(o.name));
  if (!osiris) return;
  const ORG = osiris.id;
  console.log(`\n--- ${osiris.name} (${ORG}) ---`);

  const coaCount = await prisma.chartOfAccount.count({ where: { organizationId: ORG } });
  const coa = await prisma.chartOfAccount.findMany({
    where: { organizationId: ORG, isActive: true },
    select: { id: true, code: true, name: true, accountType: true, category: true },
    orderBy: { code: 'asc' },
  });
  console.log(`CoA accounts: ${coaCount}`);
  const bankish = coa.filter((a) => /bank|cash/i.test(a.accountType) || /bank|cash|aspire|dbs|ocbc|uob|paypal|stripe|wise/i.test(a.name));
  console.log('Bank/cash-looking accounts:');
  bankish.forEach((a) => console.log(`   ${a.code} | ${a.name} | ${a.accountType} | ${a.category}`));

  const je = await prisma.journalEntry.groupBy({ by: ['status'], where: { organizationId: ORG }, _count: { _all: true } });
  console.log('Journal entries by status:', JSON.stringify(je));
  const first = await prisma.journalEntry.findFirst({ where: { organizationId: ORG }, orderBy: { entryDate: 'asc' }, select: { entryDate: true, journalNumber: true } });
  const last = await prisma.journalEntry.findFirst({ where: { organizationId: ORG }, orderBy: { entryDate: 'desc' }, select: { entryDate: true, journalNumber: true } });
  console.log('JE range:', first?.entryDate?.toISOString().slice(0, 10), '->', last?.entryDate?.toISOString().slice(0, 10));
  const jeTypes = await prisma.journalEntry.groupBy({ by: ['type'], where: { organizationId: ORG }, _count: { _all: true } });
  console.log('JE by type:', JSON.stringify(jeTypes));

  const docs = await prisma.document.groupBy({ by: ['type', 'status'], where: { organizationId: ORG }, _count: { _all: true } });
  console.log('Documents:', JSON.stringify(docs));

  const imports = await prisma.bankStatementImport.findMany({ where: { organizationId: ORG }, select: { id: true, source: true, filename: true, periodStart: true, periodEnd: true, status: true, endingBalance: true, _count: { select: { lines: true } } } });
  console.log('Bank statement imports:', JSON.stringify(imports, null, 1));

  const setting = await prisma.accountingSetting.findUnique({ where: { organizationId: ORG } });
  console.log('AccountingSetting present:', !!setting, setting ? `baseCurrency=${setting.baseCurrency}` : '');

  // Trial balance sanity: total debits vs credits on POSTED entries
  const agg = await prisma.journalEntryLine.aggregate({
    where: { journalEntry: { organizationId: ORG, status: 'POSTED' } },
    _sum: { debit: true, credit: true },
  });
  console.log('POSTED totals: Dr', agg._sum.debit, 'Cr', agg._sum.credit, 'diff', (agg._sum.debit || 0) - (agg._sum.credit || 0));

  const cust = await prisma.customer.count({ where: { organizationId: ORG } });
  const supp = await prisma.supplier.count({ where: { organizationId: ORG } });
  console.log('Customers:', cust, 'Suppliers:', supp);
}

main().catch(console.error).finally(() => prisma.$disconnect());
