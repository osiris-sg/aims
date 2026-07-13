import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
const prisma = createScriptPrisma();
async function main() {
  const doc = await prisma.document.findFirst({ where: { organizationId: BIOFUEL_ORG_ID, type: 'INVOICE', name: 'BI202607045' }, select: { name: true, config: true, createdAt: true } });
  if (!doc) { console.log('not found'); return; }
  const c: any = doc.config || {};
  console.log(`invoice date=${c.date} customer=${JSON.stringify(c.customer)} customerId=${c.customerId}`);
  // does a Customer row exist by that name?
  if (c.customer?.name) {
    const cust = await prisma.customer.findFirst({ where: { organizationId: BIOFUEL_ORG_ID, name: { equals: c.customer.name, mode: 'insensitive' } }, select: { id: true, name: true, xeroId: true, createdAt: true } });
    console.log('customer row by name:', cust || 'NONE');
  }
  // how many invoices have no linked customer?
  const all = await prisma.document.findMany({ where: { organizationId: BIOFUEL_ORG_ID, type: 'INVOICE' }, select: { config: true } });
  let na = 0, names = new Map<string, number>();
  for (const d of all) {
    const cc: any = d.config || {};
    if (!cc.customerId) { na++; const n = cc.customer?.name || '(no name)'; names.set(n, (names.get(n) || 0) + 1); }
  }
  console.log(`\ninvoices with NO linked customer: ${na}/${all.length}`);
  console.log('top unlinked names:', [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10));
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
