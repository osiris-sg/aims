import { createScriptPrisma } from './xero-migration/_common';
const prisma = createScriptPrisma();
async function main() {
  const d = await prisma.document.findUnique({ where: { id: 'd4802549-2660-40f5-a474-9440d3134fab' }, select: { id: true, name: true, type: true, status: true, organizationId: true, updatedAt: true } });
  console.log(d || 'DOCUMENT GONE');
  if (!d) {
    const alt = await prisma.document.findFirst({ where: { name: 'BIPL-JPSG-INV-20260713-0090' }, select: { id: true, name: true, documentTemplateId: true } });
    console.log('by name:', alt || 'also gone');
  }
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
