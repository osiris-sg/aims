// Guru 2026-07-27: BI202607107's journal credit moves 200 Sales → CD023
// Customer Deposit-Sin Hua (deposit invoice). Debit stays 610 AR.
import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
const APPLY = process.argv.includes('--apply');
const BIOFUEL = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const DOC_ID = 'b6af81e9-283d-4530-9ce2-3e0cc1fc878e';

async function run(env: string, envFile: string) {
  dotenv.config({ path: path.resolve(__dirname, '..', envFile), override: true });
  const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const je = await p.journalEntry.findFirst({
    where: { organizationId: BIOFUEL, sourceDocumentId: DOC_ID, status: 'POSTED' },
    include: { lines: { include: { account: { select: { code: true, name: true } } } } },
  });
  if (!je) { console.log(`[${env}] no POSTED JE — skip`); await p.$disconnect(); return; }
  const cd = await p.chartOfAccount.findFirst({
    where: { organizationId: BIOFUEL, code: 'CD023' }, select: { id: true, name: true },
  });
  if (!cd) throw new Error(`[${env}] CD023 missing`);
  const crLine = je.lines.find((l) => l.credit > 0);
  if (!crLine) throw new Error(`[${env}] no credit line`);
  console.log(`[${env}] ${je.journalNumber}: CR ${crLine.account?.code} ${crLine.account?.name} ($${crLine.credit}) → CD023 ${cd.name}`);
  if (crLine.account?.code === 'CD023') { console.log(`[${env}] already CD023`); await p.$disconnect(); return; }
  if (APPLY) {
    await p.journalEntryLine.update({ where: { id: crLine.id }, data: { accountId: cd.id } });
    console.log(`[${env}] updated`);
  }
  await p.$disconnect();
}
async function main() {
  await run('dev', '.env');
  await run('prod', '.env.production');
  if (!APPLY) console.log('dry-run — pass --apply');
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
