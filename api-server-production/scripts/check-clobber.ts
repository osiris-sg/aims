import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const docs = await p.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE' },
    select: { id: true, updatedAt: true, config: true },
    orderBy: { updatedAt: 'desc' },
    take: 2000,
  });
  const noCode = docs.filter((d) => {
    const cfg: any = d.config;
    return (cfg?.items || []).some((it: any) => it.taxType) && !cfg?.documentInfo?.taxCode;
  });
  console.log('uncoded-with-taxType:', noCode.length);
  for (const d of noCode.slice(0, 5)) {
    const cfg: any = d.config;
    console.log(d.id.slice(0, 8), 'updatedAt=', d.updatedAt.toISOString(), 'diKeys=', Object.keys(cfg?.documentInfo || {}).slice(0, 8).join(','), 'invNo=', cfg?.invoiceNumber ?? cfg?.documentInfo?.invoiceNumber);
  }
  // histogram of updatedAt (hour) for the uncoded
  const byHour = new Map<string, number>();
  for (const d of noCode) { const k = d.updatedAt.toISOString().slice(0, 13); byHour.set(k, (byHour.get(k) || 0) + 1); }
  console.log([...byHour.entries()].sort().map(([k, v]) => `${k}h -> ${v}`).join('\n'));
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
