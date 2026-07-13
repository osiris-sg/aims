import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const d = await p.document.findFirst({ where: { organizationId: ORG, name: 'Inv-26040015' }, select: { type: true, status: true, config: true } });
  const c: any = d?.config;
  console.log(JSON.stringify({ type: d?.type, status: d?.status, subtotal: c?.subtotal, taxAmount: c?.taxAmount, totalAmount: c?.totalAmount, xeroTax: c?.xeroTax, xeroGross: c?.xeroGross, documentInfo: c?.documentInfo, inboundChannel: c?.inboundChannel, source: c?.source, lines: (c?.lines || c?.items || []).slice(0, 2) }, null, 1));
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
