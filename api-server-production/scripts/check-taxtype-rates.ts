import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const docs = await p.document.findMany({ where: { organizationId: ORG, type: { in: ['INVOICE', 'BILL', 'CREDIT_NOTE'] } }, select: { type: true, config: true } });
  const agg = new Map<string, { net: number; tax: number; n: number }>();
  for (const d of docs) {
    for (const it of ((d.config as any)?.items || [])) {
      const key = it.taxType ?? '(null)';
      const e = agg.get(key) || { net: 0, tax: 0, n: 0 };
      e.net += Number(it.amount) || 0;
      e.tax += Number(it.taxAmount) || 0;
      e.n++;
      agg.set(key, e);
    }
  }
  for (const [k, e] of [...agg.entries()].sort((a, b) => b[1].n - a[1].n)) {
    const base = e.net - e.tax; // amount may be gross-incl; try both interpretations
    const rIncl = base > 0 ? (e.tax / base) * 100 : 0;
    const rExcl = e.net > 0 ? (e.tax / e.net) * 100 : 0;
    console.log(`${k.padEnd(18)} n=${String(e.n).padEnd(6)} tax/net=${rExcl.toFixed(2)}% tax/(net-tax)=${rIncl.toFixed(2)}%`);
  }
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
