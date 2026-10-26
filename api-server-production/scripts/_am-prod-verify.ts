/** Round AM — read-only (prod): #23 after the split, its Monthly view row, and the customers' formats. */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { PushModule } from '../src/push/push.module';
import { ShipmentsModule } from '../src/shipments/shipments.module';
import { MonthlyListService } from '../src/shipments/monthly-list.service';
import { ClientsService } from '../src/shipments/clients.service';
import { PrismaService } from '../src/common/prisma.service';
@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), PushModule, ActionLogModule, ShipmentsModule] })
class M {}
const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
(async () => {
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const prisma: any = app.get(PrismaService);
  const o = await prisma.tradeOrder.findFirst({ where: { organizationId: ORG, orderNo: 23, year: 2026 }, select: { id: true, clientPremium: true, supplierPremium: true, checkFields: true, notes: true, supplierOrder: { select: { soNo: true, qtyMt: true, piNo: true, supplierPremium: true } } } });
  console.log('#23', JSON.stringify({ ...o, notes: o.notes.split('\n').slice(-1)[0] }));
  const extra = await prisma.supplierOrder.findMany({ where: { organizationId: ORG, forOrderId: o.id }, select: { soNo: true, qtyMt: true, piNo: true, supplierPremium: true, grade: true, declarationMonth: true, contract: { select: { contractNo: true } }, steps: { select: { code: true, status: true } } } });
  console.log('split', JSON.stringify(extra));
  const m = await app.get(MonthlyListService).list(ORG, { from: '2026-12', to: '2026-12' });
  for (const b of m.blocks) for (const r of b.rows) console.log(`  ${b.client} ${r.orderNo} | ${JSON.stringify(r.supplierContractNo)} | order ton ${r.supplierTon} | ${r.orderStageLabel}${r.unconfirmed ? ' (check)' : ''} | ${r.supplierStageLabel}`);
  const cs = await app.get(ClientsService).customers(ORG);
  for (const c of cs) {
    const d = await app.get(ClientsService).customer(ORG, c.id);
    console.log(`${c.short}: ` + d.formats.filter((f) => f.choose === 'variant').map((f) => `${f.docType}=${f.generator}${f.formatConfirmed ? '' : ' (not confirmed)'} samples ${f.samples.length}`).join(' · '));
  }
  await app.close();
  process.exit(0);
})();
