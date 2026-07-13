import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  const docs = await p.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE', status: 'draft', createdAt: { gte: cutoff } },
    select: { id: true, name: true, createdAt: true, config: true },
    orderBy: { createdAt: 'desc' },
  });
  for (const d of docs) {
    const c: any = d.config;
    const items = (c?.items || []).filter((it: any) => Number(it.amount) > 0);
    console.log(d.id, d.name, 'items=', items.length, 'cust=', c?.customerId ?? c?.customer?.id ?? '-', d.createdAt.toISOString());
  }
  console.log('total recent drafts:', docs.length);
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
