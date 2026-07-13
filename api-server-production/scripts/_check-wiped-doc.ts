import { PrismaClient } from '@prisma/client';
(async () => {
  const p = new PrismaClient();
  const doc = await p.document.findFirst({ where: { name: 'BIPL-JPSG-INV-20260708-0089' } });
  if (!doc) { console.log('not found'); process.exit(0); }
  const cfg: any = doc.config || {};
  console.log('status:', doc.status, '| updatedAt:', doc.updatedAt.toISOString());
  console.log('config keys:', Object.keys(cfg).length, Object.keys(cfg).slice(0, 15).join(','));
  console.log('customer:', cfg?.customer?.name ?? cfg?.customerName ?? '(none)');
  console.log('items:', Array.isArray(cfg?.items) ? cfg.items.length : '(none)');
  console.log('nettTotal:', cfg?.documentInfo?.nettTotal ?? cfg?.nettTotal ?? '(none)');
  await p.$disconnect();
})();
