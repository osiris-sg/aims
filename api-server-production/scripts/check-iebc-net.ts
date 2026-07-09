import { PrismaClient } from '@prisma/client';
import { XeroReportsService } from '../src/statements/xero-reports.service';
const p = new PrismaClient();
async function main() {
  const svc = new XeroReportsService(p as any);
  const r = await svc.incomeExpenseByContact('52e90ba8-bfbd-48b0-bb76-4f9667bf74f1', { to: '2026-07-31', compareMonths: 4 });
  const find = (n: string) => r.data.rows.find((x: any) => x.contactName.startsWith(n) && x.type === 'Income');
  console.log('BioSepa (Xero: 6,700 Jun/May/Apr):', JSON.stringify(find('BioSepa')?.cells));
  console.log('Capital Cranes (Xero: 37537/31097/24908/12820):', JSON.stringify(find('Capital Cranes')?.cells));
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
