/** Round AO — READ-ONLY: what Orders (List · Completed) and Monthly (All, Mar 2024 – Jul 2026) return for #30–#40. */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { PushModule } from '../src/push/push.module';
import { ShipmentsModule } from '../src/shipments/shipments.module';
import { OrdersService } from '../src/shipments/orders.service';
import { MonthlyListService } from '../src/shipments/monthly-list.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), PushModule, ActionLogModule, ShipmentsModule] })
class M {}
const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
(async () => {
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  await runAsOrg(ORG, async () => {
    const o: any = await app.get(OrdersService).list(ORG, { bucket: 'completed', pageSize: 100 } as any);
    const nos = (o.items ?? o.rows ?? []).map((x: any) => x.orderNo).sort((a: number, b: number) => a - b);
    console.log('List · Completed:', nos.join(', '), '| total', o.total);
    const p: any = await app.get(OrdersService).list(ORG, { bucket: 'pending', pageSize: 100 } as any);
    console.log('List · Pending:', (p.items ?? []).map((x: any) => x.orderNo).sort((a: number, b: number) => a - b).join(', '));
    const m: any = await app.get(MonthlyListService).list(ORG, { from: '2024-03', to: '2026-07', basis: 'ship', bucket: 'completed' } as any);
    const rows = (m.blocks ?? []).flatMap((b: any) => b.rows.map((r: any) => r.kanri ?? r.orderLabel ?? r.orderNo));
    console.log('Monthly · Completed (ship 2024-03..2026-07):', [...new Set(rows)].join(', '), '| counts', JSON.stringify(m.counts));
  });
  await app.close();
  process.exit(0);
})();
