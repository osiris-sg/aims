import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
const prisma = createScriptPrisma();
async function main() {
  const d = await prisma.document.findFirst({
    where: { organizationId: BIOFUEL_ORG_ID, name: 'BIPL-JPSG-INV-20260713-0090' },
    select: { id: true, type: true, status: true, config: true },
  });
  if (!d) { console.log('not found'); return; }
  const c: any = d.config || {};
  console.log(`type=${d.type} status=${d.status} customer=${c.customer?.name || c.customerName} xeroInvoiceId=${c.xeroInvoiceId || '-'} xeroSyncedAt=${c.xeroSyncedAt || '-'}`);
  console.log(`items: ${(c.items || []).length}`);
  for (const it of c.items || []) {
    console.log(`  desc="${(it.description || '').slice(0, 40)}" qty=${it.quantity} price=${it.unitPrice} amount=${it.amount} accountCode=${it.accountCode ?? '-'} accountId=${it.accountId ?? '-'} taxType=${it.taxType ?? '-'}`);
  }
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
