import { PrismaClient } from '@prisma/client';
import { XeroReportsService } from '../src/statements/xero-reports.service';
const p = new PrismaClient();
async function main() {
  const svc = new XeroReportsService(p as any);
  const r: any = await svc.invoiceReport('52e90ba8-bfbd-48b0-bb76-4f9667bf74f1', 'payable', { from: '2026-06-01', to: '2026-06-30', level: 'detail' });
  console.log('June AP detail: lines =', r.data.lineCount, '| contacts =', r.data.groups.length, '| totals =', JSON.stringify(r.data.totals));
  const g = r.data.groups[0];
  console.log('first group:', g?.contactName, '| first line:', JSON.stringify(g?.lines?.[0])?.slice(0, 300));
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
