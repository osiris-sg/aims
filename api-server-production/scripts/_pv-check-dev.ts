import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true });
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const BIOFUEL = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const byOrg = await p.billPayment.groupBy({ by: ["organizationId"], _count: true });
  console.log("BillPayments by org:", JSON.stringify(byOrg));
  const pays = await p.billPayment.count({ where: { organizationId: BIOFUEL } });
  const recent = await p.billPayment.findMany({
    where: { organizationId: BIOFUEL },
    orderBy: { paymentDate: 'desc' }, take: 5,
    select: { paymentDate: true, amount: true, supplier: { select: { name: true } }, journalEntryId: true },
  });
  const pvJes = await p.journalEntry.count({ where: { organizationId: BIOFUEL, reference: { startsWith: 'P/V' }, status: { not: 'VOID' } } });
  console.log(`dev Biofuel: BillPayment rows = ${pays}, P/V-ref journals = ${pvJes}`);
  for (const r of recent) console.log(`  ${r.paymentDate.toISOString().slice(0,10)} ${r.amount} ${r.supplier?.name} je=${r.journalEntryId ? 'Y' : 'N'}`);
}
main().finally(() => p.$disconnect());
