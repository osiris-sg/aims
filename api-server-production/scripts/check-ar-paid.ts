import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const sample = await p.document.findFirst({ 
    where: { organizationId: ORG, type: 'INVOICE', config: { path: ['xeroImported'], equals: true } },
    select: { name: true, config: true },
  });
  if (sample) {
    const c = sample.config as any;
    console.log('Sample INVOICE doc:');
    console.log(`  name: ${sample.name}`);
    console.log(`  xeroStatus: ${c.xeroStatus}`);
    console.log(`  xeroGross: ${c.xeroGross}`);
    console.log(`  xeroBalance: ${c.xeroBalance}`);
    console.log(`  xeroAmountPaid: ${c.xeroAmountPaid}`);
  }

  // Bucket existing AR invoices by xeroStatus
  const all = await p.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE', config: { path: ['xeroImported'], equals: true } },
    select: { config: true },
  });
  const byStatus = new Map<string, number>();
  let totalOutstanding = 0;
  all.forEach(d => {
    const c = d.config as any;
    const status = c.xeroStatus || '(none)';
    byStatus.set(status, (byStatus.get(status)||0) + 1);
    totalOutstanding += (c.xeroBalance || 0);
  });
  console.log(`\nTotal AR invoices: ${all.length}`);
  console.log('By xeroStatus:');
  [...byStatus.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(`  ${k.padEnd(15)} ${v}`));
  console.log(`Total outstanding (sum of xeroBalance): $${totalOutstanding.toFixed(2)}`);
}
main().finally(()=>p.$disconnect());
