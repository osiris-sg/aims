/**
 * SiteClock deliveries, Stage 2 (2026-11-07): DEV setup for the app's Delivery
 * section. Refuses the prod database.
 *
 *   - dev WCT: enableSiteClockLink + enableSiteClockDeliveries ON (DEV only), the
 *     SiteClock connection pointed at the local SiteClock (:4100) with the local
 *     keys, and the dev WCT field tech linked to SiteClock "Cal Worker 1";
 *   - scheduled jobs for Cal Worker 1, the same lines as the SiteJobs reference
 *     runs #240 / #241 / #242 (notes "SCD-UI"), plus one more #240-shaped job for
 *     the two-device test; each synced so it is a SiteClock job with Delivery on.
 *
 *   SC_KEY_FILE=… INBOUND_KEY_FILE=… AIMS_SECRETS_KEY=<same as the API> TENANCY_MODE=per-org \
 *   npx ts-node -r tsconfig-paths/register --transpile-only scripts/_scd-ui-setup.ts
 *
 * Nothing is restored at the end: the flag stays ON for dev WCT (dev WCT's
 * SiteClock connection only reaches a local SiteClock).
 */
import 'dotenv/config';
import * as fs from 'fs';
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
import { SiteClockLinkService } from '../src/siteclock/siteclock-link.service';
import { seal } from '../src/common/secret-box';
import { hashInboundKey } from '../src/job-photos/job-photos';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const SC_URL = 'http://localhost:4100';
const SC_COMPANY = 'cmvugwzon0000wvcolvovrqqm';
const W1 = 'cmvugwzos0002wvco3s0oocjs'; // Cal Worker 1
const TECH = 'user_3LF2lbGtnHKWtC12nfn9cdS8fYB'; // dev WCT member with the field-tech role
const SITE = '10 Anson Road, Singapore 079903';
const SC_KEY = (fs.readFileSync(process.env.SC_KEY_FILE || '', 'utf8').match(/sck_live_[A-Za-z0-9_-]+/) || [])[0] || '';
const INBOUND = fs.readFileSync(process.env.INBOUND_KEY_FILE || '', 'utf8').trim();

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, PushModule, ActionLogModule, DeliveriesModule] })
class M {}
const noop = () => new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : async () => undefined) });
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Today in Singapore at hh:00 (as an ISO instant). */
const today = (hh: number) => {
  const d = new Date(Date.now() + 8 * 3600_000);
  d.setUTCHours(hh - 8, 0, 0, 0);
  return d.toISOString();
};

(async () => {
  const prod = (process.env.PROD_DATABASE_URL || '').replace(/["\r]/g, '');
  if (prod && new URL(process.env.DATABASE_URL || '').host === new URL(prod).host) throw new Error('Refusing: prod database');
  if (!SC_KEY || !INBOUND.startsWith('aims_sck_')) throw new Error('SC_KEY_FILE and INBOUND_KEY_FILE are required');
  const mod = await Test.createTestingModule({ imports: [M] }).overrideProvider(StaffWhatsAppService).useValue(noop()).overrideProvider(PushService).useValue(noop()).compile();
  const prisma = mod.get(PrismaService);
  const deliveries = mod.get(DeliveriesService);
  const link = mod.get(SiteClockLinkService);

  const ui: any = await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } });
  await prisma.organizationUIConfig.update({
    where: { organizationId: WCT },
    data: { features: { ...(ui?.features || {}), enableSiteClockLink: true, enableSiteClockDeliveries: true } },
  });
  const conn = { baseUrl: SC_URL, siteclockCompanyId: SC_COMPANY, apiKeyEnc: seal(SC_KEY), apiKeyLast4: SC_KEY.slice(-4), enabled: true, defaultDurationMin: 60, inboundKeyHash: hashInboundKey(INBOUND), inboundKeyLast4: INBOUND.slice(-4), inboundKeyCreatedAt: new Date() };
  await prisma.siteClockConnection.upsert({ where: { organizationId: WCT }, create: { organizationId: WCT, ...conn }, update: conn });
  const profile = await prisma.organizationMemberProfile.findFirst({ where: { organizationId: WCT, userId: TECH } });
  if (profile) await prisma.organizationMemberProfile.update({ where: { id: profile.id }, data: { siteclockUserId: W1 } });
  else await prisma.organizationMemberProfile.create({ data: { organizationId: WCT, userId: TECH, siteclockUserId: W1 } });
  (link as any).linkedOrgs = null;
  console.log('dev WCT: deliveries ON, connection → local SiteClock, field tech ↔ Cal Worker 1');

  const out: Array<{ label: string; deliveryNumber: number; id: string; externalRef?: string }> = [];
  await runAsOrg(WCT, async () => {
    let customer = await prisma.customer.findFirst({ where: { organizationId: WCT, name: 'Golden Wok Kitchen Pte Ltd' } });
    if (!customer) customer = await prisma.customer.create({ data: { organizationId: WCT, name: 'Golden Wok Kitchen Pte Ltd', address: SITE } as any });
    const assign = { siteclockWorkerId: W1, siteclockWorkerName: 'Cal Worker 1', siteclockDurationMin: 60 };
    const schedule = async (label: string, hh: number, lines: Array<{ description: string; quantity: number; assetClass: string }>) => {
      const r: any = await deliveries.createScheduled({ scheduledFor: today(hh), items: lines, customerId: customer!.id, address: SITE, notes: `SCD-UI ${label}`, ...assign } as any, WCT);
      out.push({ label, deliveryNumber: 0, id: r?.id ?? r?.delivery?.id });
    };
    await schedule('as #240 (service + equipment)', 10, [
      { description: 'Kitchen exhaust hood degreasing', quantity: 1, assetClass: 'SERVICE' },
      { description: 'Replacement filter unit', quantity: 1, assetClass: 'EQUIPMENT' },
    ]);
    await schedule('as #241 (service + accessory ×2)', 14, [
      { description: 'Exhaust duct inspection', quantity: 1, assetClass: 'SERVICE' },
      { description: 'Grease cup', quantity: 2, assetClass: 'ACCESSORY' },
    ]);
    await schedule('two-device test (as #240)', 11, [
      { description: 'Kitchen exhaust hood degreasing', quantity: 1, assetClass: 'SERVICE' },
      { description: 'Replacement filter unit', quantity: 1, assetClass: 'EQUIPMENT' },
    ]);
    const R = randomUUID();
    const n = ((await prisma.delivery.aggregate({ where: { organizationId: WCT }, _max: { deliveryNumber: true } }))._max.deliveryNumber ?? 0) + 1;
    await prisma.delivery.create({ data: { id: R, organizationId: WCT, deliveryNumber: n, direction: 'RETURN', status: 'scheduled', scheduledFor: new Date(today(16)), customerId: customer.id, siteAddress: SITE, notes: 'SCD-UI as #242 (return)' } as any });
    await prisma.deliveryItem.create({ data: { deliveryId: R, description: 'Portable exhaust fan (hire)', quantity: 1, assetClass: 'EQUIPMENT', sortOrder: 1 } as any });
    await link.onScheduleSaved(WCT, R, { workerId: W1, workerName: 'Cal Worker 1', durationMin: 60 });
    out.push({ label: 'as #242 (return)', deliveryNumber: n, id: R });

    for (const o of out) {
      let l = await prisma.deliverySiteClockJob.findUnique({ where: { deliveryId: o.id } });
      for (let i = 0; !l && i < 20; i++) {
        await settle(500);
        l = await prisma.deliverySiteClockJob.findUnique({ where: { deliveryId: o.id } });
      }
      for (let i = 0; l && i < 40; i++) {
        await link.syncLink(l.id);
        l = await prisma.deliverySiteClockJob.findUnique({ where: { deliveryId: o.id } });
        if (l?.syncState === 'SYNCED') break;
        await settle(500);
      }
      const d = await prisma.delivery.findFirst({ where: { id: o.id }, select: { deliveryNumber: true } });
      o.deliveryNumber = d?.deliveryNumber ?? o.deliveryNumber;
      o.externalRef = l?.externalRef;
      console.log(`#${o.deliveryNumber}  ${o.label}  ${o.id}  ${l?.syncState ?? 'NO LINK'}  ${l?.externalRef ?? ''}`);
    }
  });
  fs.writeFileSync(process.env.OUT_FILE || '/dev/null', JSON.stringify(out, null, 2));
  await mod.close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
