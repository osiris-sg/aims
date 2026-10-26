/** Round AM — DEV only: dump the Clients / Orders / Monthly API answers of dev ADH for the portal's fixture preview (screenshots). Writes one JSON file (--out=), nothing else. */
import 'dotenv/config';
import * as fs from 'fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ClientsService } from '../src/shipments/clients.service';
import { MonthlyListService } from '../src/shipments/monthly-list.service';
import { OrdersService } from '../src/shipments/orders.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42';
const out = process.argv.find((a) => a.startsWith('--out='))!.slice(6);
(async () => {
  if (process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) throw new Error('dev only');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const clients = app.get(ClientsService);
  const monthly = app.get(MonthlyListService);
  const orders = app.get(OrdersService);
  await runAsOrg(ORG, async () => {
    const customers = await clients.customers(ORG);
    const suppliers = await clients.suppliers(ORG);
    const detail: Record<string, unknown> = {};
    for (const c of customers) detail[c.id] = await clients.customer(ORG, c.id);
    const sdetail: Record<string, unknown> = {};
    for (const s of suppliers) sdetail[s.id] = await clients.supplier(ORG, s.id);
    const previewShipments: Record<string, unknown> = {};
    for (const c of customers) previewShipments[c.id] = await clients.previewShipments(ORG, c.id);
    const month = '2026-10';
    const monthlyAll = await monthly.list(ORG, { from: month, to: month });
    const monthlyBy: Record<string, unknown> = {};
    for (const c of customers) monthlyBy[c.id] = await monthly.list(ORG, { from: month, to: month, customerId: c.id });
    const ordersAll = await orders.list(ORG, { bucket: 'pending', page: '1', pageSize: '20' } as any);
    const ordersBy: Record<string, unknown> = {};
    for (const c of customers) ordersBy[c.id] = await orders.list(ORG, { bucket: 'pending', customerId: c.id, page: '1', pageSize: '20' } as any);
    fs.writeFileSync(out, JSON.stringify({ customers, suppliers, detail, sdetail, previewShipments, monthlyAll, monthlyBy, ordersAll, ordersBy }, null, 0));
    console.log('wrote', out, fs.statSync(out).size, 'bytes');
  });
  await app.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
