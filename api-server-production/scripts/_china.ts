import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const custs = await p.customer.findMany({ where: { organizationId: ORG, name: { contains: 'China Railway', mode: 'insensitive' } }, select: { id: true, name: true, xeroId: true } });
  console.log(`China Railway customers: ${custs.length}`);
  for (const c of custs) {
    const docs = await p.document.count({ where: { organizationId: ORG, type: 'INVOICE', config: { path: ['customerId'], equals: c.id } } });
    const txns = await p.transaction.count({ where: { organizationId: ORG, customerId: c.id } });
    console.log(`  "${c.name}"\n     xeroId=${c.xeroId ? 'yes' : 'NO'}  invoices(docs)=${docs}  transactions=${txns}  id=${c.id}`);
  }
  // where is BI202601060 tagged?
  for (const n of ['BI202601060','BI202605151','BI202606083']) {
    const d = await p.document.findFirst({ where: { organizationId: ORG, type: 'INVOICE', name: n }, select: { config: true } });
    const c: any = d?.config || {};
    console.log(`\n${n}: customer="${c.customer?.name}" balance=${c.xeroBalance} status-date=${String(c.date).slice(0,10)}`);
  }
  // Total transactions in the whole org (is the Transaction table maintained at all?)
  const totalTxn = await p.transaction.count({ where: { organizationId: ORG } });
  console.log(`\nTotal Transaction rows in org: ${totalTxn}  (vs ${await p.document.count({where:{organizationId:ORG,type:'INVOICE'}})} invoices)`);
}
main().catch(e=>console.log('ERR',e.message)).finally(()=>p.$disconnect());
