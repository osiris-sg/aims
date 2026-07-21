import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
const p = createScriptPrisma();
async function main() {
  // remove the placeholder short-name deposit account from the first pass
  const del = await p.chartOfAccount.deleteMany({ where: { organizationId: BIOFUEL_ORG_ID, name: 'Customer Deposit-Lam Hwa' } });
  console.log(`dropped placeholder accounts: ${del.count}`);
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
