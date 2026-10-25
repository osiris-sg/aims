/** Round AL — DEV: the carrier-email rule + CarrierTrackingService.fromEmail on dev #19-1 (sample Wan Hai notice). Refuses prod. */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CarrierTrackingService } from '../src/shipments/carrier-tracking.service';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { knownSender } from '../src/ingestion-email/email-triage.rules';
const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42';
const subject = 'Cargo Status Notification (ETA Change) - B/L No. 198GX06522';
const body = `Dear Valued Customer,\n\nPlease be advised of the following schedule change for your shipment.\n\nB/L No.: 198GX06522\nOcean Vessel/Voyage: WAN HAI 366 / 51  Loading Port: VIZAG  ETD: 2026/10/06\nT/S Port: PORT KLANG NORTH PORT  ETA: 2026/10/10\nConnecting Vessel/Voyage: WAN HAI 365 / N046  ETD: 2026/10/20\nPort of Discharging: YOKOHAMA  New ETA: 2026/11/01 (previous ETA 2026/10/29)\n\nWAN HAI LINES LTD. e-Service (this is an automatic notice)`;
(async () => {
  if (process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) throw new Error('dev only');
  const hit = knownSender({ from: 'WAN HAI e-Service <eservice@wanhai.com>', subject, body, attachments: [] });
  console.log('rule:', hit?.rule, 'blNo:', hit?.blNo);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const t = app.get(CarrierTrackingService);
  const prisma: any = app.get(PrismaService);
  await runAsOrg(ORG, async () => {
    const r = await t.fromEmail(ORG, randomUUID(), `${subject}\n${body}`, hit?.blNo ?? null);
    console.log('fromEmail:', JSON.stringify(r));
    const s = await prisma.shipment.findFirst({ where: { organizationId: ORG, blNumber: '198GX06522' }, select: { eta: true, etaHistory: true, arrivingVessel: true, arrivingVoyageNo: true, tsPort: true } });
    console.log('#19-1 after:', JSON.stringify(s));
  });
  await app.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
