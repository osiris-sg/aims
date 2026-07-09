import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';

  console.log('═══ AR INVOICES ═══');
  const invoices = await p.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE', config: { path: ['xeroImported'], equals: true } },
    select: { config: true },
  });
  const arByStatus = new Map<string, { count: number; totalValue: number; outstanding: number }>();
  let arTotalOutstanding = 0;
  invoices.forEach(d => {
    const c = d.config as any;
    const s = c.xeroStatus || '(none)';
    const e = arByStatus.get(s) || { count: 0, totalValue: 0, outstanding: 0 };
    e.count++;
    e.totalValue += (c.xeroGross || 0);
    e.outstanding += (c.xeroBalance || 0);
    arByStatus.set(s, e);
    arTotalOutstanding += (c.xeroBalance || 0);
  });
  [...arByStatus.entries()].sort((a,b)=>b[1].count-a[1].count).forEach(([s,r]) =>
    console.log(`  ${s.padEnd(12)} ${String(r.count).padStart(4)}  total $${r.totalValue.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}).padStart(14)}  outstanding $${r.outstanding.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}).padStart(14)}`)
  );
  console.log(`  TOTAL AR outstanding: $${arTotalOutstanding.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`);

  console.log('\n═══ AP BILLS ═══');
  const bills = await p.document.findMany({
    where: { organizationId: ORG, type: 'BILL', config: { path: ['xeroImported'], equals: true } },
    select: { config: true },
  });
  const apByStatus = new Map<string, { count: number; totalValue: number; outstanding: number }>();
  let apTotalOutstanding = 0;
  bills.forEach(d => {
    const c = d.config as any;
    const s = c.xeroStatus || '(none)';
    const e = apByStatus.get(s) || { count: 0, totalValue: 0, outstanding: 0 };
    e.count++;
    e.totalValue += (c.xeroGross || 0);
    e.outstanding += (c.xeroBalance || 0);
    apByStatus.set(s, e);
    apTotalOutstanding += (c.xeroBalance || 0);
  });
  [...apByStatus.entries()].sort((a,b)=>b[1].count-a[1].count).forEach(([s,r]) =>
    console.log(`  ${s.padEnd(12)} ${String(r.count).padStart(4)}  total $${r.totalValue.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}).padStart(14)}  outstanding $${r.outstanding.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}).padStart(14)}`)
  );
  console.log(`  TOTAL AP outstanding: $${apTotalOutstanding.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`);
}
main().finally(()=>p.$disconnect());
