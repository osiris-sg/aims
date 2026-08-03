import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const envFile = process.argv[2] || '.env';
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG = 'd068f159-e45a-4da8-beaf-62e903f44141';
async function main() {
  console.log(`==== ${envFile} ====`);
  const docs = await prisma.document.findMany({
    where: { organizationId: ORG, type: { in: ['INVOICE', 'BILL', 'PO'] } },
    select: { id: true, name: true, type: true, status: true, config: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const d of docs as any[]) {
    const c = (d.config || {}) as any;
    const date = c.invoiceDate || c.date || c.documentDate || c.issueDate || '';
    const total = c.total ?? c.grandTotal ?? c.totalAmount ?? c.amount ?? '';
    const cust = c.customer?.name || c.customerName || c.supplier?.name || c.supplierName || '';
    console.log(`${d.type.padEnd(8)} ${String(d.name).padEnd(20)} ${d.status.padEnd(24)} ${String(date).slice(0,10).padEnd(11)} ${String(total).padStart(12)}  ${cust}`);
  }
  const custs = await prisma.customer.findMany({ where: { organizationId: ORG }, select: { name: true } });
  console.log('Customers:', custs.map((c: any) => c.name).join(' | '));
  const sup = await prisma.supplier.findMany({ where: { organizationId: ORG }, select: { name: true } });
  console.log('Suppliers:', sup.map((s: any) => s.name).join(' | ') || '(none)');
  console.log('Payments:', await prisma.payment.count({ where: { organizationId: ORG } as any }));
  console.log('Bills(table):', await prisma.bill.count({ where: { organizationId: ORG } as any }));
}
main().catch((e) => console.error(e.message)).finally(() => prisma.$disconnect());
