/** READ-ONLY proof (prod): the aged / invoice summary / income-expense reports are identical with the lighter scan. */
import * as dotenv from 'dotenv';
dotenv.config({ path: '/Users/elroylee/Desktop/aims/api-server-production/.env' });
import { PrismaClient } from '@prisma/client';
import { XeroReportsService } from '../src/statements/xero-reports.service';

class OldScan extends XeroReportsService {
  protected async scanDocRows(organizationId: string, type: 'INVOICE' | 'BILL') {
    return (this as any).prisma.document.findMany({ where: { organizationId, type }, select: { id: true, name: true, type: true, documentTemplateId: true, status: true, createdAt: true, config: true } });
  }
}
(async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL } } });
  await prisma.$executeRawUnsafe('SET default_transaction_read_only = on').catch(() => undefined);
  const orgs = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT o.id, o.name FROM "Organization" o WHERE EXISTS (SELECT 1 FROM "Document" d WHERE d."organizationId" = o.id AND d.type IN ('INVOICE','BILL')) ORDER BY o.name`;
  const lite = new XeroReportsService(prisma as any);
  const old = new OldScan(prisma as any);
  let bad = 0;
  for (const o of orgs) {
    const calls: Array<[string, (s: XeroReportsService) => Promise<any>]> = [
      ['aged AR detail', (s) => s.aged(o.id, 'receivable', { asOf: '2026-11-19', level: 'detail' })],
      ['aged AP detail', (s) => s.aged(o.id, 'payable', { asOf: '2026-11-19', level: 'detail' })],
      ['invoice AR', (s) => s.invoiceReport(o.id, 'receivable', { from: '2026-01-01', to: '2026-11-19' })],
      ['income/expense', (s) => s.incomeExpenseByContact(o.id, { to: '2026-11-19' })],
    ];
    const res: string[] = [];
    for (const [label, fn] of calls) {
      const t0 = Date.now();
      const a = JSON.stringify(await fn(old));
      const t1 = Date.now();
      const b = JSON.stringify(await fn(lite));
      const t2 = Date.now();
      const same = a === b;
      if (!same) bad++;
      res.push(`${label} ${same ? 'same' : 'DIFFERENT'} (${t1 - t0} vs ${t2 - t1} ms, ${a.length} chars)`);
    }
    console.log(`${o.name.slice(0, 28).padEnd(28)} ${res.join(' | ')}`);
  }
  console.log(bad ? `${bad} DIFFERENT` : 'ALL IDENTICAL');
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e?.message || e); process.exit(1); });
