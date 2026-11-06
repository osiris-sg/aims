/**
 * SiteClock deliveries: fixtures on DEV WCT for the SiteJobs reference
 * screenshots (docs/do-clone-reference). Two scheduled jobs (a service line +
 * an equipment line) and a scheduled return (an equipment line), notes
 * "SCD-REF". Refuses the prod database.
 *   TENANCY_MODE=per-org npx ts-node -r tsconfig-paths/register --transpile-only scripts/_scd-ref-fixtures.ts
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from '../config/configuration';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { ClerkModule } from '../src/clerk/clerk.module';
import { PushModule } from '../src/push/push.module';
import { PushService } from '../src/push/push.service';
import { StaffWhatsAppService } from '../src/staff-whatsapp/staff-whatsapp.service';
import { DeliveriesModule } from '../src/deliveries/deliveries.module';
import { DeliveriesService } from '../src/deliveries/deliveries.service';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const SITE = '10 Anson Road, Singapore 079903';
@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, PushModule, ActionLogModule, DeliveriesModule] })
class M {}
const noop = () => new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : async () => undefined) });
const today = (hh: number) => {
  const d = new Date(Date.now() + 8 * 3600_000);
  d.setUTCHours(hh - 8, 0, 0, 0);
  return d.toISOString();
};

(async () => {
  const prod = (process.env.PROD_DATABASE_URL || '').replace(/["\r]/g, '');
  if (prod && new URL(process.env.DATABASE_URL || '').host === new URL(prod).host) throw new Error('Refusing: prod database');
  const mod = await Test.createTestingModule({ imports: [M] }).overrideProvider(StaffWhatsAppService).useValue(noop()).overrideProvider(PushService).useValue(noop()).compile();
  const prisma = mod.get(PrismaService);
  const deliveries = mod.get(DeliveriesService);
  await runAsOrg(WCT, async () => {
    let customer = await prisma.customer.findFirst({ where: { organizationId: WCT, name: 'Golden Wok Kitchen Pte Ltd' } });
    if (!customer) customer = await prisma.customer.create({ data: { organizationId: WCT, name: 'Golden Wok Kitchen Pte Ltd', address: SITE } as any });
    const ids: string[] = [];
    for (const [hh, lines] of [
      [10, [{ description: 'Kitchen exhaust hood degreasing', quantity: 1, assetClass: 'SERVICE' }, { description: 'Replacement filter unit', quantity: 1, assetClass: 'EQUIPMENT' }]],
      [14, [{ description: 'Exhaust duct inspection', quantity: 1, assetClass: 'SERVICE' }, { description: 'Grease cup', quantity: 2, assetClass: 'ACCESSORY' }]],
    ] as const) {
      const r: any = await deliveries.createScheduled({ scheduledFor: today(hh), items: lines as any, customerId: customer.id, address: SITE, notes: 'SCD-REF' } as any, WCT);
      ids.push(r.id);
    }
    const R = randomUUID();
    const n = ((await prisma.delivery.aggregate({ where: { organizationId: WCT }, _max: { deliveryNumber: true } }))._max.deliveryNumber ?? 0) + 1;
    await prisma.delivery.create({ data: { id: R, organizationId: WCT, deliveryNumber: n, direction: 'RETURN', status: 'scheduled', scheduledFor: new Date(today(16)), customerId: customer.id, siteAddress: SITE, notes: 'SCD-REF return' } as any });
    await prisma.deliveryItem.create({ data: { deliveryId: R, description: 'Portable exhaust fan (hire)', quantity: 1, assetClass: 'EQUIPMENT', sortOrder: 1 } as any });
    ids.push(R);
    const runs = await prisma.delivery.findMany({ where: { id: { in: ids } }, select: { id: true, deliveryNumber: true, direction: true } });
    console.log(JSON.stringify(runs));
  });
  await mod.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
