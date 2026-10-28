/**
 * Round AT — owner's GO: renumber ADH 2026 orders to Sayaka's Task List in ONE transaction (temporary 900000+old
 * first, then final; each keeps its old number in previousOrderNos), then create #24 (Sankyo Tateyama · PT Sri Indah ·
 * 6063 · 50 t · PI SIAE_PI_26100906 · ship 2026-10 · delivery 2026-12, PI file attached). #23 stays free. Document
 * IDs untouched. Activity Log row per change + script log. Dry run unless --apply.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { PushModule } from '../src/push/push.module';
import { ShipmentsModule } from '../src/shipments/shipments.module';
import { OrdersService } from '../src/shipments/orders.service';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), PushModule, ActionLogModule, ShipmentsModule] })
class M {}
const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const YEAR = 2026;
const APPLY = process.argv.includes('--apply');
const MAP: Record<number, number> = { 23: 25, 24: 26, 25: 27, 26: 28, 27: 9001, 28: 9002, 29: 9003 };
for (let i = 30; i <= 40; i++) MAP[i] = 1001 + (i - 30);
const ACTOR = { id: 'system:round-at-renumber', name: "System creation (owner's go, round AT)" };
const PI_FILE = 'cc6281c0-1ab4-426b-aef1-ed59dab9ac45';
(async () => {
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const log: any[] = [];
  await runAsOrg(ORG, async () => {
    const prisma: any = app.get(PrismaService);
    const orders = app.get(OrdersService);
    const before = await prisma.tradeOrder.findMany({ where: { organizationId: ORG, year: YEAR, orderNo: { in: Object.keys(MAP).map(Number) } }, select: { id: true, orderNo: true, previousOrderNos: true } });
    if (before.length !== Object.keys(MAP).length) throw new Error(`expected ${Object.keys(MAP).length} orders, found ${before.length}`);
    const clash = await prisma.tradeOrder.findMany({ where: { organizationId: ORG, year: YEAR, orderNo: { in: Object.values(MAP) }, id: { notIn: before.map((o: any) => o.id) } }, select: { orderNo: true } });
    if (clash.length) throw new Error(`target numbers taken: ${clash.map((c: any) => c.orderNo).join(',')}`);
    const others = await prisma.tradeOrder.count({ where: { organizationId: { not: ORG } } });
    console.log(`${APPLY ? '*** APPLY ***' : 'DRY RUN'} · moving ${before.length} orders · other orgs' orders: ${others}`);
    for (const o of before.sort((a: any, b: any) => a.orderNo - b.orderNo)) console.log(`  #${o.orderNo} → #${MAP[o.orderNo]}`);
    const cust = await prisma.customer.findFirst({ where: { organizationId: ORG, name: { contains: 'Sankyo', mode: 'insensitive' } }, select: { id: true, name: true } });
    const sup = await prisma.supplier.findFirst({ where: { organizationId: ORG, name: { contains: 'Sri Indah' } }, select: { id: true, name: true } });
    const pi = await prisma.tradeFile.findFirst({ where: { id: PI_FILE, organizationId: ORG }, select: { id: true, fileName: true } });
    console.log(`new #24: ${cust?.name} · ${sup?.name} · 6063 · 50 t · PI SIAE_PI_26100906 · ship 2026-10 · delivery 2026-12 · PI file ${pi?.fileName ?? 'MISSING'}`);
    if (!cust || !sup || !pi) throw new Error('customer / supplier / PI file missing');
    if (!APPLY) return;
    await prisma.$transaction(async (tx: any) => {
      for (const o of before) await tx.tradeOrder.update({ where: { id: o.id }, data: { orderNo: 900000 + o.orderNo } });
      for (const o of before) await tx.tradeOrder.update({ where: { id: o.id }, data: { orderNo: MAP[o.orderNo], previousOrderNos: { push: o.orderNo } } });
    }, { timeout: 60_000 });
    for (const o of before) {
      await prisma.actionLog.create({ data: { organizationId: ORG, actorType: 'SYSTEM', actorId: ACTOR.id, actorName: 'System creation', channel: 'cron', action: 'UPDATE', resource: 'trade-orders', resourceId: o.id, details: { orderNo: { from: o.orderNo, to: MAP[o.orderNo] }, year: YEAR, reason: "Sayaka's Task List numbering (owner's go)" } } });
      log.push({ at: new Date().toISOString(), action: 'RENUMBER', orderId: o.id, from: o.orderNo, to: MAP[o.orderNo] });
    }
    console.log('renumbered (one transaction) + Activity Log rows');
    const created: any = await orders.create(ORG, { year: YEAR, orderNo: 24, customerId: cust.id, supplierId: sup.id, grade: '6063', qtyMt: 50, piNo: 'SIAE_PI_26100906', shipMonth: '2026-10', deliveryMonth: '2026-12', piFileId: pi.id } as any, ACTOR as any);
    await prisma.actionLog.create({ data: { organizationId: ORG, actorType: 'SYSTEM', actorId: ACTOR.id, actorName: 'System creation', channel: 'cron', action: 'CREATE', resource: 'trade-orders', resourceId: created.id, details: { orderNo: 24, customer: cust.name, supplier: sup.name, grade: '6063', qtyMt: 50, piNo: 'SIAE_PI_26100906', shipMonth: '2026-10', deliveryMonth: '2026-12', piFile: pi.fileName } } });
    log.push({ at: new Date().toISOString(), action: 'CREATE', orderId: created.id, orderNo: 24, piFile: pi.id });
    console.log(`created #${created.orderNo} (${created.id}) status ${created.status}`);
  });
  if (APPLY) fs.writeFileSync('scripts/_au-renumber-go.log.json', JSON.stringify(log, null, 1));
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('ERR', e?.message); process.exit(1); });
