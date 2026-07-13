// READ-ONLY: count Biofuel bills dated / created 11 Jun 2026 in PROD.
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const org = await p.organization.findFirst({ where: { name: { contains: 'Biofuel', mode: 'insensitive' } }, select: { id: true, name: true } });
  if (!org) { console.log('No Biofuel org found in prod'); return; }
  console.log('org:', org.name, org.id);
  const docs = await p.document.findMany({
    where: { organizationId: org.id, type: 'BILL' },
    select: { id: true, name: true, status: true, createdAt: true, config: true },
  });
  const byBillDate = docs.filter((d) => String((d.config as any)?.billDate ?? (d.config as any)?.date ?? '').slice(0, 10) === '2026-07-11');
  const byCreatedAt = docs.filter((d) => d.createdAt.toISOString().slice(0, 10) === '2026-07-11');
  console.log(`total BILL docs: ${docs.length}`);
  console.log(`bill DATE 2026-07-11: ${byBillDate.length}`);
  for (const d of byBillDate.slice(0, 20)) {
    const c: any = d.config;
    console.log(`  ${d.name}  supplier=${c?.supplier?.name ?? c?.supplierId ?? '?'}  total=${c?.totalAmount ?? c?.xeroGross ?? '?'}  status=${d.status}`);
  }
  console.log(`record CREATED 2026-07-11: ${byCreatedAt.length}`);
  for (const d of byCreatedAt.slice(0, 20)) {
    const c: any = d.config;
    console.log(`  ${d.name}  billDate=${String(c?.billDate ?? c?.date ?? '?').slice(0, 10)}  total=${c?.totalAmount ?? c?.xeroGross ?? '?'}  status=${d.status}`);
  }
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
