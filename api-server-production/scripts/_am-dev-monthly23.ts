/** Round AM — DEV read: the Monthly view rows of #23 / #24 after the split rehearsal. */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { MonthlyListService } from '../src/shipments/monthly-list.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42';
(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  await runAsOrg(ORG, async () => {
    const m = await app.get(MonthlyListService).list(ORG, { from: '2026-12', to: '2026-12' });
    for (const b of m.blocks) for (const r of b.rows) console.log(`${b.client} ${r.orderNo} | contract ${JSON.stringify(r.supplierContractNo)} | order ton ${r.supplierTon} | ${r.orderStageLabel}${r.unconfirmed ? ' (check)' : ''} | ${r.supplierStageLabel}`);
  });
  await app.close();
  process.exit(0);
})();
