import { PrismaClient } from '@prisma/client';
(async () => {
  const p = new PrismaClient();
  const logs = await p.auditLog.findMany({
    where: { resource: 'document' },
    orderBy: { createdAt: 'desc' },
    take: 15,
  });
  for (const l of logs) {
    const d: any = l.details || {};
    const detail = String(d.detail || '').slice(0, 120);
    console.log(l.createdAt.toISOString(), l.action, l.resourceId?.slice(0, 8), '::', detail);
  }
  // find the empty-strings entry
  const hit = logs.find((l: any) => String((l.details as any)?.detail || '').includes('to ""'));
  if (hit) {
    console.log('\nWIPE ENTRY doc:', hit.resourceId);
    const doc = await p.document.findUnique({ where: { id: hit.resourceId! } });
    if (doc) {
      const cfg: any = doc.config || {};
      console.log('name:', JSON.stringify(doc.name), 'status:', doc.status, 'type:', doc.type);
      console.log('config keys:', Object.keys(cfg).length, ':', Object.keys(cfg).slice(0, 20).join(','));
      console.log('items:', Array.isArray(cfg?.items) ? cfg.items.length : '(none)');
    } else console.log('doc gone');
  } else console.log('\nno wipe entry in last 15');
  await p.$disconnect();
})();
