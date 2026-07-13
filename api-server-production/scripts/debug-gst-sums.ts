import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const R = (n: number) => Math.round(n * 100) / 100;
async function main() {
  const docs = await p.document.findMany({
    where: { organizationId: ORG, type: { in: ['INVOICE', 'TI', 'TI2', 'BILL', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PURCHASE_RETURN'] } },
    select: { name: true, type: true, status: true, createdAt: true, config: true },
  });
  const from = new Date('2026-04-01'); const to = new Date('2026-06-30T23:59:59');
  const agg = new Map<string, { net: number; tax: number; n: number }>();
  const suspects: string[] = [];
  for (const d of docs) {
    const c: any = d.config || {};
    const st = (d.status || '').toLowerCase();
    if (st === 'draft' || st === 'cancelled' || c.voided) continue;
    const di: any = c.documentInfo || {};
    const code = di.taxCode != null && di.taxCode !== '' ? String(di.taxCode) : null;
    if (!code) continue;
    const date = c.date ? new Date(c.date) : c.billDate ? new Date(c.billDate) : d.createdAt;
    if (date < from || date > to) continue;
    const tax = R(Number(di.gstAmount ?? c.taxAmount ?? c.xeroTax ?? 0) || 0);
    let net = Number(di.subTotal ?? c.subtotal ?? c.subTotal ?? NaN);
    if (!Number.isFinite(net)) { const gross = Number(c.xeroGross ?? di.nettTotal ?? c.nettTotal ?? c.totalAmount ?? 0) || 0; net = R(gross - tax); }
    const k = `${d.type}:${code}`;
    const e = agg.get(k) || { net: 0, tax: 0, n: 0 };
    e.net += net; e.tax += tax; e.n++;
    agg.set(k, e);
    if (code === '4' && net > 0 && tax > net * 0.15) suspects.push(`${d.name} net=${net} tax=${tax}`);
  }
  for (const [k, e] of [...agg.entries()].sort()) console.log(k.padEnd(18), 'n=', String(e.n).padEnd(5), 'net=', R(e.net), 'tax=', R(e.tax));
  console.log('suspect code-4 docs (tax >> 9% of net):', suspects.slice(0, 8), suspects.length);
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
