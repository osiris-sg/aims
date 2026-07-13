import { getXeroTokens, xeroGet, createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
const prisma = createScriptPrisma();
async function main() {
  const tokens = await getXeroTokens(prisma, BIOFUEL_ORG_ID);
  for (const num of ['CY005448', '2605-000179']) {
    const res = await xeroGet<any>(tokens, '/Invoices', { where: `InvoiceNumber=="${num}" && Type=="ACCPAY"` });
    console.log(`\n${num}: ${res.Invoices?.length ?? 0} bill(s) in Xero`);
    for (const i of res.Invoices || []) {
      console.log(`  id=${i.InvoiceID} status=${i.Status} date=${i.DateString} due=${i.AmountDue} total=${i.Total} contact=${i.Contact?.Name}`);
    }
  }
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
