import { createScriptPrisma } from './xero-migration/_common';
const prisma = createScriptPrisma();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const docs = await prisma.document.findMany({
    where: { organizationId: ORG, name: { in: ['CY005448', '2605-000179'] } },
    select: { id: true, name: true, type: true, status: true, config: true, createdAt: true },
  });
  console.log(`rows: ${docs.length}`);
  for (const d of docs) {
    const c: any = d.config || {};
    console.log(`${d.name} type=${d.type} status=${d.status} xeroBillId=${c.xeroBillId || '-'} xeroInvoiceId=${c.xeroInvoiceId || '-'} xeroStatus=${c.xeroStatus || '-'} balance=${c.xeroBalance ?? '-'} created=${d.createdAt.toISOString()}`);
  }
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
