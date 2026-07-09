import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const billDocs = await p.document.count({ where: { organizationId: ORG, type: 'BILL' } });
  const oldBillTable = await p.bill.count({ where: { organizationId: ORG } });
  console.log(`BILL Documents: ${billDocs}`);
  console.log(`Legacy Bill table: ${oldBillTable}`);

  // Sample one to confirm config has the fields the new toBill() reads
  const sample = await p.document.findFirst({
    where: { organizationId: ORG, type: 'BILL' },
    select: { id: true, name: true, status: true, config: true, attachments: true },
  });
  if (sample) {
    const c = sample.config as any;
    console.log(`\nSample bill: ${sample.name}`);
    console.log(`  status: ${sample.status} | xeroStatus: ${c.xeroStatus} | billStatus: ${c.billStatus || '(not set)'}`);
    console.log(`  total: ${c.xeroGross} | balance: ${c.xeroBalance}`);
    console.log(`  supplier: ${c.supplier?.name}`);
  }
}
main().finally(()=>p.$disconnect());
