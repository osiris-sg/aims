/** Remove JPSG journals for postpaid (company_type null) companies — their
 *  billing flows through the normal AR/invoice pipeline, not deposits. */
import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
import { Client } from 'pg';
import * as fs from 'fs';
const prisma = createScriptPrisma();
const jpsgUrl = fs.readFileSync('.env', 'utf8').match(/^JPSG_DATABASE=\s*(.+)$/m)![1].trim();
async function main() {
  const jpsg = new Client({ connectionString: jpsgUrl });
  await jpsg.connect();
  const postpaid = (await jpsg.query(`SELECT id, name FROM companies WHERE company_type IS NULL`)).rows;
  await jpsg.end();
  const ids = new Set(postpaid.map((r: any) => `Customer Deposit-${r.name}`));
  let jeDeleted = 0, acctDeleted = 0;
  for (const name of ids) {
    const acct = await prisma.chartOfAccount.findFirst({ where: { organizationId: BIOFUEL_ORG_ID, name } });
    if (!acct) continue;
    const jls = await prisma.journalEntryLine.findMany({ where: { accountId: acct.id }, select: { journalEntryId: true } });
    const jeIds = [...new Set(jls.map((l) => l.journalEntryId))];
    // only JPSG-created entries
    const jes = await prisma.journalEntry.findMany({ where: { id: { in: jeIds }, reference: { startsWith: 'JPSG:' } }, select: { id: true } });
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: jes.map((j) => j.id) } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jes.map((j) => j.id) } } });
    jeDeleted += jes.length;
    const remaining = await prisma.journalEntryLine.count({ where: { accountId: acct.id } });
    if (remaining === 0) { await prisma.chartOfAccount.delete({ where: { id: acct.id } }); acctDeleted++; }
  }
  console.log(`reverted: ${jeDeleted} journals, ${acctDeleted} postpaid deposit accounts removed`);
  console.log(`(postpaid companies stay on the normal AR/invoice pipeline — no deposit accounting)`);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
