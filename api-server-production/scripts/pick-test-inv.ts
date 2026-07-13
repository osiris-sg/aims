import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const docs = await p.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE', name: { startsWith: 'BIPL-JPSG' } },
    select: { id: true, name: true, documentTemplateId: true, createdAt: true, config: true },
  });
  const d = docs.find((x) => x.createdAt.toISOString().slice(0, 10) === '2026-07-11' && (x.config as any)?.items?.some((it: any) => it.itemCode === 'SV025'));
  const c: any = d?.config;
  const line = c?.items?.find((it: any) => it.itemCode === 'SV025');
  console.log(d?.name);
  console.log('customer:', c?.customer?.name ?? c?.customerName);
  console.log('line:', JSON.stringify(line));
  console.log(`url: https://www.ai-ms.io/portal/documents/INVOICE/${d?.documentTemplateId}/${d?.id}`);
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
