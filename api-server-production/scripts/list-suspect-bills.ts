import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const R = (n: number) => Math.round(n * 100) / 100;
async function main() {
  const docs = await p.document.findMany({
    where: { organizationId: ORG, type: 'BILL' },
    select: { id: true, name: true, status: true, config: true },
  });
  for (const d of docs) {
    const c: any = d.config || {};
    const di: any = c.documentInfo || {};
    if (di.taxCode !== '4') continue;
    const tax = Number(di.gstAmount ?? c.taxAmount ?? c.xeroTax ?? 0) || 0;
    let net = Number(di.subTotal ?? c.subtotal ?? c.subTotal ?? NaN);
    if (!Number.isFinite(net)) { const gross = Number(c.xeroGross ?? c.totalAmount ?? 0) || 0; net = R(gross - tax); }
    if (net > 0 && tax > net * 0.15) {
      const lines = (c.lines || c.items || []) as any[];
      const lineSum = R(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));
      console.log(
        `${d.name}  supplier=${c.supplierName ?? c.supplier?.name ?? c.supplierId ?? '?'}  date=${String(c.billDate ?? c.date ?? '').slice(0, 10)}  ` +
        `xeroGross=${c.xeroGross}  xeroTax=${c.xeroTax}  computedNet=${net}  lineSum=${lineSum}  lines=${lines.length}  status=${d.status}  xeroStatus=${c.xeroStatus ?? '-'}  curr=${c.currency ?? '-'}`,
      );
    }
  }
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
