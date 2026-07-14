import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const cutoff = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  const docs = await p.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE', createdAt: { gte: cutoff } },
    select: { id: true, name: true, status: true, createdAt: true, config: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log('recent invoices:', docs.length);
  for (const d of docs.slice(0, 5)) {
    const c: any = d.config;
    const di: any = c?.documentInfo || {};
    console.log(`  ${d.name}  status=${d.status}  created=${d.createdAt.toISOString().slice(0, 16)}  sub=${di.subTotal ?? c?.subTotal}  gst=${di.gstAmount}  nett=${di.nettTotal}  curr=${di.currency ?? c?.currency}`);
  }
  const setting = await p.accountingSetting.findUnique({ where: { organizationId: ORG } });
  console.log('accountingSetting exists:', !!setting, 'controlAccounts:', JSON.stringify(setting?.controlAccounts ?? null));
  const je = await p.journalEntry.findMany({ where: { organizationId: ORG, createdAt: { gte: cutoff } }, select: { journalNumber: true, type: true, reference: true, status: true } });
  console.log('recent journal entries:', je.length, JSON.stringify(je.slice(0, 5)));
  const coa = await p.chartOfAccount.count({ where: { organizationId: ORG } });
  console.log('CoA accounts:', coa);
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
