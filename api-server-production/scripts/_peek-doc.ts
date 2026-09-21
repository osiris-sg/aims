import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  for (const id of process.argv.slice(2).filter((a) => !a.startsWith('dotenv_'))) {
    const d = await prisma.document.findUnique({ where: { id }, select: { name: true, type: true, status: true, createdAt: true, projectId: true, config: true } });
    if (!d) { console.log(`${id}: not found\n`); continue; }
    const c: any = d.config || {};
    console.log(`${d.name} [${d.type}] ${d.status}  created ${d.createdAt.toISOString().slice(0,16)}`);
    console.log(`  customer: ${typeof c.customer === 'string' ? c.customer : c.customer?.name || '(none)'}`);
    console.log(`  projectId: ${d.projectId || '(none)'}   saleOrderId: ${c.saleOrderId || '(none)'}   poNo: ${c.poNo || '(none)'}`);
    console.log(`  source: ${c.sourceDocumentType || '(none)'} ${c.sourceDocumentNumber || ''}`);
    for (const it of (c.items || []).slice(0, 6)) console.log(`   - ${it.quantity ?? '?'} x ${String(it.description || it.sku || '').slice(0,60)}  @${it.unitPrice ?? 0}`);
    console.log();
  }
  await prisma.$disconnect();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
