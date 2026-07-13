import { PrismaClient } from '@prisma/client';
(async () => {
  const p = new PrismaClient();
  const logs = await p.auditLog.findMany({
    where: { resource: 'document', action: 'EDITED' },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const wipes = logs.filter((l: any) => String((l.details as any)?.detail || '').includes('to ""'));
  const byDoc = new Map<string, any[]>();
  wipes.forEach((l) => byDoc.set(l.resourceId!, [...(byDoc.get(l.resourceId!) || []), l]));
  console.log(`EDITED entries scanned: ${logs.length}, wipe-style entries: ${wipes.length}, distinct docs: ${byDoc.size}`);
  for (const [id, ls] of Array.from(byDoc.entries())) {
    const doc = await p.document.findUnique({ where: { id } });
    const cfg: any = doc?.config || {};
    console.log(`- ${doc?.name ?? '(gone)'} [${doc?.status}] xeroImported=${!!cfg.xeroImported} items=${Array.isArray(cfg.items) ? cfg.items.length : '-'} customer=${JSON.stringify(cfg?.customer?.name ?? cfg?.customerName ?? null)} wipes=${ls.length} last=${ls[0].createdAt.toISOString()}`);
  }
  await p.$disconnect();
})();
