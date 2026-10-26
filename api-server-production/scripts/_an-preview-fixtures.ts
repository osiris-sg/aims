/** Round AN — DEV only: the round AM fixture dump plus the Orders page's shared-header variants (tabs, search) for the
 * Monthly and List views, keyed by the normalised query. Writes one JSON file (--out=), nothing else. */
import 'dotenv/config';
import * as fs from 'fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { MonthlyListService } from '../src/shipments/monthly-list.service';
import { OrdersService } from '../src/shipments/orders.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42';
const out = process.argv.find((a) => a.startsWith('--out='))!.slice(6);
const base = process.argv.find((a) => a.startsWith('--base='))?.slice(7);
const norm = (q: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').sort(([a], [b]) => a.localeCompare(b))));
(async () => {
  if (process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) throw new Error('dev only');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const monthly = app.get(MonthlyListService);
  const orders = app.get(OrdersService);
  const prev = base ? JSON.parse(fs.readFileSync(base, 'utf8')) : {};
  const monthlyQ: Record<string, unknown> = {};
  const ordersQ: Record<string, unknown> = {};
  await runAsOrg(ORG, async () => {
    for (const m of ['2026-09', '2026-10', '2026-11'])
      for (const bucket of ['pending', 'completed', undefined])
        for (const q of [undefined, '198GX06516', '#16']) {
          const query = { from: m, to: m, basis: 'delivery', bucket, q };
          monthlyQ[norm(query)] = await monthly.list(ORG, query as any);
        }
    for (const bucket of ['pending', 'completed', 'all'])
      for (const q of [undefined, '198GX06516', '#16']) {
        const f = { page: 1, pageSize: 20, bucket, q };
        ordersQ[norm(f)] = await orders.list(ORG, { ...f, page: '1', pageSize: '20' } as any);
      }
  });
  fs.writeFileSync(out, JSON.stringify({ ...prev, monthlyQ, ordersQ }));
  console.log('wrote', out, fs.statSync(out).size, 'bytes');
  await app.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
