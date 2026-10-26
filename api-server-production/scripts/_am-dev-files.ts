/** Round AM — read-only (dev): ADH dev customers, profiles keys, shipments with COA / PL source files. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42';
const p = new PrismaClient();
(async () => {
  console.log((await p.customer.findMany({ where: { organizationId: ORG }, select: { id: true, name: true } })).map((c) => `${c.id} ${c.name}`).join('\n'));
  const ts = await p.tradeSetting.findUnique({ where: { organizationId: ORG }, select: { customerProfiles: true } });
  console.log('profiles', Object.entries((ts?.customerProfiles ?? {}) as any).map(([k, v]: any) => `${k}:${v.key}:${JSON.stringify(v.docVariants)}`));
  const files: any[] = await p.tradeFile.findMany({ where: { organizationId: ORG, docType: { in: ['COA_XLS', 'PL_XLS', 'COA', 'PL'] } }, select: { docType: true, fileName: true, links: { select: { shipment: { select: { seqNo: true, blNumber: true, order: { select: { orderNo: true, customer: { select: { name: true } } } } } } } } } });
  for (const f of files) console.log(f.docType, f.fileName, f.links.map((l: any) => l.shipment ? `#${l.shipment.order?.orderNo}-${l.shipment.seqNo} ${l.shipment.blNumber} ${l.shipment.order?.customer?.name}` : '').join(','));
  await p.$disconnect();
})();
