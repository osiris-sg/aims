import { PrismaClient } from '@prisma/client';
(async () => {
  const p = new PrismaClient();
  const logs = await p.auditLog.findMany({
    where: { resource: 'document', details: { path: ['detail'], string_contains: 'BIPL-JPSG-INV-20260708-0089' } },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log('audit entries found:', logs.length);
  for (const l of logs) {
    console.log('---', l.action, l.createdAt.toISOString(), 'resourceId:', l.resourceId);
    console.log(JSON.stringify(l.details).slice(0, 300));
  }
  const docId = logs[0]?.resourceId;
  if (docId) {
    const doc = await p.document.findUnique({ where: { id: docId } });
    if (doc) {
      const cfg: any = doc.config || {};
      console.log('DOC name:', JSON.stringify(doc.name), '| status:', doc.status, '| type:', doc.type);
      console.log('config keys:', Object.keys(cfg).length, Object.keys(cfg).slice(0, 15).join(','));
      console.log('items:', Array.isArray(cfg?.items) ? cfg.items.length : '(none)');
    } else console.log('doc missing (deleted?)');
  }
  await p.$disconnect();
})();
