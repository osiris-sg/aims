import { PrismaClient } from '@prisma/client';
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const prisma = new PrismaClient();
async function main() {
  const url = process.env.DATABASE_URL || '';
  console.log('DB host:', url.match(/@([^/]+)\//)?.[1] || '(unknown)');
  const docTypes = await prisma.document.groupBy({ by: ['type'], where: { organizationId: ORG }, _count: true });
  console.log('Documents by type:', docTypes.map(d => `${d.type}=${d._count}`).join('  '));
  const je = await prisma.journalEntry.count({ where: { organizationId: ORG } });
  const jeByPoster = await prisma.journalEntry.groupBy({ by: ['postedBy'], where: { organizationId: ORG }, _count: true });
  const jel = await prisma.journalEntryLine.count({ where: { journalEntry: { organizationId: ORG } } });
  console.log(`JournalEntry=${je}  lines=${jel}`);
  console.log('JE by postedBy:', jeByPoster.map(g => `${g.postedBy ?? 'null'}=${g._count}`).join('  '));
  const pay = await prisma.payment.count({ where: { organizationId: ORG } });
  const billPay = await prisma.billPayment.count({ where: { organizationId: ORG } });
  console.log(`Payment=${pay}  BillPayment=${billPay}`);
  const conn = await prisma.xeroConnection.findUnique({ where: { organizationId: ORG }, select: { tenantId: true, refreshTokenExpiresAt: true } });
  console.log('XeroConnection:', conn ? `tenant=${conn.tenantId} refreshExpires=${conn.refreshTokenExpiresAt.toISOString()}` : 'NONE');
  const coa = await prisma.chartOfAccount.count({ where: { organizationId: ORG } });
  console.log(`ChartOfAccount=${coa}`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
