import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const docs = await p.document.findMany({ where: { organizationId: ORG, type: { in: ['INVOICE', 'BILL', 'CREDIT_NOTE'] } }, select: { type: true, config: true }, take: 3000 });
  const counts = new Map<string, number>();
  for (const d of docs) {
    const items: any[] = (d.config as any)?.items || [];
    for (const it of items) {
      const k = `${d.type}:${it.taxType ?? '(null)'}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  console.log([...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} = ${v}`).join('\n'));
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
