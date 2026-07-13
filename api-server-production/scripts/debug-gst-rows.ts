import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const docs = await p.document.findMany({
    where: { organizationId: ORG, type: { in: ['INVOICE', 'TI', 'TI2', 'BILL', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PURCHASE_RETURN'] } },
    select: { id: true, name: true, type: true, status: true, createdAt: true, config: true },
  });
  const from = new Date('2026-04-01'); const to = new Date('2026-06-30T23:59:59');
  let total = 0, noCode = 0, badStatus = 0, outOfRange = 0, ok = 0;
  const statusCounts = new Map<string, number>();
  for (const d of docs) {
    total++;
    const c: any = d.config || {};
    const st = (d.status || '').toLowerCase();
    statusCounts.set(st, (statusCounts.get(st) || 0) + 1);
    if (st === 'draft' || st === 'cancelled') { badStatus++; continue; }
    const di: any = c.documentInfo || {};
    if (di.taxCode == null || di.taxCode === '') { noCode++; continue; }
    const date = c.date ? new Date(c.date) : c.billDate ? new Date(c.billDate) : d.createdAt;
    if (date < from || date > to) { outOfRange++; continue; }
    ok++;
  }
  console.log({ total, badStatus, noCode, outOfRange, ok });
  console.log('statuses:', [...statusCounts.entries()]);
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
