import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const count = await p.chartOfAccount.count({ where: { organizationId: ORG } });
  console.log('staging Biofuel CoA rows:', count);
  let acct = await p.chartOfAccount.findFirst({ where: { organizationId: ORG, code: '105' } });
  if (!acct) {
    acct = await p.chartOfAccount.create({
      data: { organizationId: ORG, code: '105', name: 'Contra account', accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT', isActive: true },
    });
    console.log('created account 105 (Contra account, CURRENT_ASSET)');
  } else console.log('account 105 exists:', acct.name);
  const upd = await p.revenueItem.updateMany({ where: { organizationId: ORG, code: 'SV025' }, data: { accountId: acct.id } });
  console.log('linked SV025 accountId:', upd.count);
}
main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
