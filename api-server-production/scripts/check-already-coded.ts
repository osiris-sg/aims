import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const docs = await p.document.findMany({
    where: { organizationId: ORG, type: { in: ['INVOICE', 'BILL', 'CREDIT_NOTE', 'DEBIT_NOTE'] } },
    select: { id: true, updatedAt: true, config: true },
  });
  const counts = new Map<string, number>();
  let latest: any = null;
  for (const d of docs) {
    const di: any = (d.config as any)?.documentInfo;
    if (!di?.taxCode) continue;
    const k = `${di.taxCode}@${di.gstPercent}`;
    counts.set(k, (counts.get(k) || 0) + 1);
    if (!latest || d.updatedAt > latest.updatedAt) latest = { id: d.id, u: d.updatedAt };
  }
  console.log([...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `taxCode ${k} -> ${v}`).join('\n'));
  console.log('most recently updated coded doc:', latest);
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
