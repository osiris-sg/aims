// READ-ONLY: Biofuel invoices created 11 Jul 2026 in PROD.
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const docs = await p.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE' },
    select: { id: true, name: true, status: true, createdAt: true, config: true },
  });
  const jul11 = docs.filter((d) => d.createdAt.toISOString().slice(0, 10) === '2026-07-11');
  console.log(`invoices created 2026-07-11: ${jul11.length} (of ${docs.length} invoices total)`);
  const byStatus = new Map<string, number>();
  const byChannel = new Map<string, number>();
  let gross = 0;
  for (const d of jul11) {
    const c: any = d.config;
    byStatus.set(d.status, (byStatus.get(d.status) || 0) + 1);
    const ch = c?.inboundChannel || (c?.xeroImported ? 'XERO' : 'MANUAL/other');
    byChannel.set(ch, (byChannel.get(ch) || 0) + 1);
    gross += Number(c?.totalAmount ?? c?.nettTotal ?? c?.xeroGross) || 0;
  }
  console.log('by status:', [...byStatus.entries()].map(([k, v]) => `${k}=${v}`).join(' '));
  console.log('by channel:', [...byChannel.entries()].map(([k, v]) => `${k}=${v}`).join(' '));
  console.log('sum of totals:', gross.toFixed(2));
  for (const d of jul11.slice(0, 25)) {
    const c: any = d.config;
    const di: any = c?.documentInfo || {};
    console.log(`  ${d.name}  date=${String(c?.date ?? c?.billDate ?? di?.date ?? '?').slice(0, 10)}  cust=${c?.customer?.name ?? c?.customerName ?? c?.customerId ?? '?'}  total=${c?.totalAmount ?? di?.nettTotal ?? c?.xeroGross ?? '?'}  status=${d.status}  taxCode=${di?.taxCode ?? '-'}  absorb=${di?.absorbTax ?? '-'}`);
  }
  if (jul11.length > 25) console.log(`  ... and ${jul11.length - 25} more`);
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
