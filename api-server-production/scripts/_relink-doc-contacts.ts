/** Re-link INVOICE/BILL/CREDIT_NOTE docs whose customerId/supplierId is null
 *  by matching config.customer.name / supplier.name against the contact
 *  tables (exact, case-insensitive — both names come from Xero verbatim). */
import { Prisma } from '@prisma/client';
import { createScriptPrisma, BIOFUEL_ORG_ID, withDbRetry } from './xero-migration/_common';
const prisma = createScriptPrisma();
async function main() {
  const docs = await prisma.document.findMany({
    where: { organizationId: BIOFUEL_ORG_ID, type: { in: ['INVOICE', 'BILL', 'CREDIT_NOTE'] } },
    select: { id: true, name: true, type: true, config: true },
  });
  const customers = await prisma.customer.findMany({ where: { organizationId: BIOFUEL_ORG_ID }, select: { id: true, name: true } });
  const suppliers = await prisma.supplier.findMany({ where: { organizationId: BIOFUEL_ORG_ID }, select: { id: true, name: true } });
  const custByName = new Map(customers.map((c) => [c.name.trim().toLowerCase(), c]));
  const supByName = new Map(suppliers.map((s) => [s.name.trim().toLowerCase(), s]));
  let fixed = 0, stillNa = 0;
  for (const d of docs) {
    const c: any = d.config || {};
    const isAr = d.type === 'INVOICE' || (d.type === 'CREDIT_NOTE' && c.subtype === 'AR');
    if (isAr && !c.customerId && c.customer?.name) {
      const m = custByName.get(c.customer.name.trim().toLowerCase());
      if (m) {
        await withDbRetry(() => prisma.document.update({ where: { id: d.id }, data: { config: { ...c, customerId: m.id, customer: { id: m.id, name: m.name } } as Prisma.InputJsonValue } }), d.name || d.id);
        console.log(`  linked ${d.type} ${d.name} → customer ${m.name}`);
        fixed++;
      } else { stillNa++; console.log(`  ✗ still no customer row for "${c.customer.name}" (${d.name})`); }
    }
    if (!isAr && d.type !== 'INVOICE' && !c.supplierId && c.supplier?.name) {
      const m = supByName.get(c.supplier.name.trim().toLowerCase());
      if (m) {
        await withDbRetry(() => prisma.document.update({ where: { id: d.id }, data: { config: { ...c, supplierId: m.id, supplier: { id: m.id, name: m.name } } as Prisma.InputJsonValue } }), d.name || d.id);
        console.log(`  linked ${d.type} ${d.name} → supplier ${m.name}`);
        fixed++;
      } else { stillNa++; console.log(`  ✗ still no supplier row for "${c.supplier.name}" (${d.name})`); }
    }
  }
  console.log(`\nrelinked ${fixed}; unresolved ${stillNa}`);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
