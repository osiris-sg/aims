/** Round AL — DEV end-to-end: real reader on the 198GX06523 paste + screenshot; WhatsApp card → Confirm on dev #19-2. Refuses the prod DB. */
import 'dotenv/config';
import * as fs from 'fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CarrierTrackingService } from '../src/shipments/carrier-tracking.service';
import { ShipmentsToolsService } from '../src/operator/shipments-tools.service';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';

const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42'; // dev ADH
const SHIP = '8b7ddcfd-e93b-4651-a2b7-52e0cf800f89'; // dev #19-2
const dir = 'src/shipments/__fixtures__';
(async () => {
  if (process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) throw new Error('dev only');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const tracking = app.get(CarrierTrackingService);
  const tools = app.get(ShipmentsToolsService);
  const prisma: any = app.get(PrismaService);
  await runAsOrg(ORG, async () => {
    const before = await prisma.shipment.findFirst({ where: { id: SHIP }, select: { eta: true, etaHistory: true, arrivingVessel: true, tsPort: true } });
    console.log('BEFORE', JSON.stringify(before));
    // 1) Portal path, pasted text (read only)
    const t = await tracking.read(ORG, { shipmentId: SHIP, text: fs.readFileSync(`${dir}/wanhai-198GX06523.txt`, 'utf8'), source: 'PASTE' }, { id: 'dev-test', name: 'Dev test' });
    console.log('\nPASTE', t.ref, 'bl', t.bl, 'dropped', JSON.stringify(t.snapshot.dropped));
    for (const r of t.rows) console.log(`  ${r.label} | ${r.aims ?? '—'} → ${r.tracking ?? '—'} | ${r.status}${r.handTyped ? ' (typed)' : ''}${r.suggested ? ' ✓' : ''}`);
    // 2) WhatsApp path, screenshot → card → Confirm
    const ctx: any = { organizationId: ORG, organizationName: 'ADH (dev)', actor: { id: 'dev-test', name: 'Dev test', email: null }, channelUserId: 'dev', roles: [], isOsirisAdmin: true, channel: 'web' };
    const card: any = await tools.trackingCard(ctx, { image: { buffer: fs.readFileSync(`${dir}/wanhai-198GX06523.png`), mimetype: 'image/png' } }, null, 'en');
    console.log('\nWHATSAPP CARD:\n' + (card.pending?.summary ?? JSON.stringify(card.result)));
    if (card.pending) {
      const done = await tools.runPending(ctx, { ...card.pending, id: 'x' });
      console.log('CONFIRM →', done.message);
    }
    const after = await prisma.shipment.findFirst({ where: { id: SHIP }, select: { eta: true, etd: true, etaHistory: true, vessel: true, voyageNo: true, arrivingVessel: true, arrivingVoyageNo: true, tsPort: true, tsEta: true, tsEtd: true, blReleaseType: true } });
    console.log('\nAFTER', JSON.stringify(after));
    const rows = await prisma.shipmentTracking.findMany({ where: { shipmentId: SHIP }, orderBy: { createdAt: 'asc' }, select: { source: true, applied: true, raw: true } });
    console.log('snapshots:', rows.map((r: any) => `${r.source}${r.applied ? ' applied ' + r.applied.fields.join(',') : ''} (${r.raw?.model}, ${r.raw?.tokens?.join('/')} tok)`).join(' | '));
  });
  await app.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
