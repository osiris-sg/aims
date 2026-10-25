/** Round AL — DEV only: put dev #19-2 back as it was before the tracking test (for the UI screenshot). */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42';
const SHIP = '8b7ddcfd-e93b-4651-a2b7-52e0cf800f89';
(async () => {
  if (process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) throw new Error('dev only');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma: any = app.get(PrismaService);
  await runAsOrg(ORG, async () => {
    const s = await prisma.shipment.findFirst({ where: { id: SHIP }, select: { etaHistory: true } });
    await prisma.shipment.update({ where: { id: SHIP }, data: { eta: new Date('2026-10-29'), etd: null, arrivingVessel: null, arrivingVoyageNo: null, tsPort: null, tsEta: null, tsEtd: null, blReleaseType: null, portOfLoading: null, portOfDischarge: null, containerCount: null, etaHistory: (s.etaHistory as any[]).slice(0, 1) } });
    console.log('dev #19-2 reset; order', (await prisma.shipment.findFirst({ where: { id: SHIP }, select: { orderId: true } })).orderId);
  });
  await app.close();
  process.exit(0);
})();
