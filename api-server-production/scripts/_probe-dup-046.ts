import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
const prisma = createScriptPrisma();
async function main() {
  const docs = await prisma.document.findMany({
    where: { organizationId: BIOFUEL_ORG_ID, name: 'BI202607046' },
    select: { id: true, documentTemplateId: true, status: true, createdAt: true, updatedAt: true, config: true },
  });
  console.log(`rows named BI202607046: ${docs.length}`);
  for (const d of docs) {
    const c: any = d.config || {};
    console.log(`- id=${d.id.slice(0,8)} tmpl=${d.documentTemplateId?.slice(0,8)} status=${d.status} created=${d.createdAt.toISOString()} updated=${d.updatedAt.toISOString()}`);
    console.log(`    xeroImported=${!!c.xeroImported} nettTotal=${c.nettTotal} savedBy=${c.savedBy || '-'} issueBy=${c.issueBy || '-'} sourceDoc=${c.sourceDocumentType || '-'} ${c.sourceDocumentNumber || ''}`);
  }
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
