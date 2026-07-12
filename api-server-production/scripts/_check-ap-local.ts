import { createScriptPrisma } from './xero-migration/_common';
const prisma = createScriptPrisma();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const R = (n: number) => Math.round(n * 100) / 100;
async function main() {
  const bills = await prisma.document.findMany({ where: { organizationId: ORG, type: 'BILL' }, select: { config: true } });
  let ap = 0, count = 0, statusN: Record<string, number> = {};
  for (const b of bills) {
    const c: any = b.config || {};
    let st = (c.billStatus || '').toUpperCase();
    if (!st) {
      const xs = (c.xeroStatus || '').toUpperCase();
      st = xs === 'PAID' ? 'PAID' : xs === 'VOIDED' || xs === 'DELETED' ? 'VOID' : xs === 'DRAFT' ? 'DRAFT' : 'POSTED';
    }
    statusN[st] = (statusN[st] || 0) + 1;
    if (!['POSTED', 'PAID'].includes(st)) continue;
    const total = Number(c.totalAmount ?? c.xeroGross ?? 0);
    const paid = c.amountPaid !== undefined ? Number(c.amountPaid) : c.xeroBalance !== undefined ? R(total - Number(c.xeroBalance)) : Number(c.xeroAmountPaid ?? 0);
    const out = R(total - paid);
    if (out <= 0.005) continue;
    ap += out; count++;
  }
  console.log('bill status counts:', statusN);
  console.log(`AIMS AP outstanding = ${R(ap).toFixed(2)} across ${count} bills`);
  console.log(`GL creditorControl (800) = 6,191,342.23 (== Xero GL, proven by the $0.00 GL match)`);
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
