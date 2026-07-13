import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const docs = await p.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE', name: { startsWith: 'BIPL-JPSG' } },
    select: { id: true, name: true, createdAt: true, config: true },
  });
  const jul11 = docs.filter((d) => d.createdAt.toISOString().slice(0, 10) === '2026-07-11');
  console.log('jul11 BIPL-JPSG invoices:', jul11.length);
  const sample: any = jul11[0]?.config;
  console.log('sample', jul11[0]?.name, JSON.stringify(sample?.items ?? sample?.lines, null, 1)?.slice(0, 900));
  // survey line descriptions
  const descs = new Map<string, number>();
  for (const d of jul11) {
    const c: any = d.config;
    for (const it of c?.items ?? c?.lines ?? []) {
      const k = String(it.description || '').slice(0, 45);
      descs.set(k, (descs.get(k) || 0) + 1);
    }
  }
  console.log('line desc prefixes:', [...descs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
  const codes = await p.revenueItem.findMany({ where: { organizationId: ORG, code: { in: ['SV025', 'SV026'] } }, select: { code: true, name: true } });
  console.log('SV025/26 taken?', JSON.stringify(codes));
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
