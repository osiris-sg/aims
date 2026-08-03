import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
const BIOFUEL = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true });
  const dev = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const parent = await dev.chartOfAccount.findUnique({ where: { id: '88c53a34-401a-42b8-a42d-21ce994cfeee' }, select: { code: true, name: true, accountType: true } });
  console.log('dev CD parent:', JSON.stringify(parent));
  const cds = await dev.chartOfAccount.findMany({ where: { organizationId: BIOFUEL, code: { startsWith: 'CD' } }, select: { code: true, parentAccountId: true } });
  const noParent = cds.filter(c => !c.parentAccountId).map(c => c.code);
  console.log('dev CD rows without parent:', noParent.join(',') || 'none');
  // JE for the invoice in dev
  const jes = await dev.journalEntry.findMany({
    where: { organizationId: BIOFUEL, sourceDocumentId: 'b6af81e9-283d-4530-9ce2-3e0cc1fc878e' },
    include: { lines: { include: { account: { select: { code: true, name: true } } } } },
  });
  console.log('dev JEs for BI202607107:', jes.length);
  for (const j of jes) {
    console.log(` ${j.journalNumber} ${j.status} isUnconfirmed=${(j as any).isUnconfirmed} ref=${j.reference} date=${j.entryDate?.toISOString()?.slice(0,10)}`);
    for (const l of j.lines) console.log(`   ${l.account?.code} ${l.account?.name}: D${l.debit} C${l.credit}`);
  }
  await dev.$disconnect();

  dotenv.config({ path: path.resolve(__dirname, '..', '.env.production'), override: true });
  const prod = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  if (parent) {
    const prodParent = await prod.chartOfAccount.findFirst({ where: { organizationId: BIOFUEL, code: parent.code }, select: { id: true, code: true, name: true } });
    console.log('prod parent by code', parent.code, ':', JSON.stringify(prodParent));
  }
  const prodCount = await prod.chartOfAccount.count({ where: { organizationId: BIOFUEL } });
  console.log('prod Biofuel CoA count:', prodCount);
  await prod.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
