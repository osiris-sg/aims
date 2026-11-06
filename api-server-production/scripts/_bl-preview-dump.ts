/**
 * Round BL — READ-ONLY preview fixture for the AIMEE screenshots: #18 / #18-1 (order page), its Overall process, the
 * Dashboard's question cards and tasks, from prod (DBURL inline, TENANCY_MODE=; every write throws). Merges the live
 * AIMEE transcripts (scripts/_bl-aimee-live.ts --out) under `aimee`. --out=<json> --live=<json>
 */
import 'dotenv/config';
import * as fs from 'fs';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { OrdersService } from '../src/shipments/orders.service';
import { ShipmentsService } from '../src/shipments/shipments.service';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { TradeDueService } from '../src/shipments/trade-due.service';
import { TradeTaxInputsService } from '../src/shipments/trade-tax-inputs';
import { TradeGeneratedService } from '../src/shipments/trade-generated.service';
import { TradeStepsService } from '../src/shipments/trade-steps.service';
import { EmailTriageService } from '../src/ingestion-email/email-triage.service';
import { S3Service } from '../src/common/services/s3.service';

const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const WRITES = /^(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe|\$transaction)$/;
function readOnly(p: PrismaClient): any {
  return new Proxy(p as any, {
    get(t, k: string) {
      if (WRITES.test(k)) throw new Error(`read-only: ${k}`);
      const v = t[k];
      if (v && typeof v === 'object' && !k.startsWith('$'))
        return new Proxy(v, { get: (m, op: string) => { if (WRITES.test(op)) throw new Error(`read-only: ${k}.${op}`); const f = m[op]; return typeof f === 'function' ? f.bind(m) : f; } });
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}
(async () => {
  const raw = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  const prisma = readOnly(raw);
  const config = new TradeConfigService(prisma);
  const due = new TradeDueService(prisma);
  const shipments = new ShipmentsService(prisma, config, undefined, undefined, undefined, new TradeTaxInputsService(prisma));
  const orders = new OrdersService(prisma, config, shipments, undefined, due);
  const s3 = new S3Service(new ConfigService());
  const triage = new EmailTriageService(prisma, s3, { list: async () => ({ items: [] }) } as any, config, new TradeStepsService(prisma, config), { log: async () => undefined, system: async () => undefined } as any);
  const o = await raw.tradeOrder.findFirst({ where: { organizationId: ORG, orderNo: 18 }, select: { id: true, shipments: { where: { seqNo: 1 }, select: { id: true } } } });
  const sid = o!.shipments[0].id;
  const order = await orders.getById(ORG, o!.id);
  const ship: any = await shipments.getById(ORG, sid);
  const gen = Object.create(TradeGeneratedService.prototype);
  Object.assign(gen, { prisma, config });
  const genS = await gen.list(ORG, { shipmentId: sid }).catch(() => []);
  const genO = await gen.list(ORG, { orderId: o!.id }).catch(() => []);
  const proc = await due.orderProcess(ORG, o!.id);
  const dashboard = await triage.dashboard(ORG, 'en', { admin: false });
  const dashboardJa = await triage.dashboard(ORG, 'ja', { admin: false });
  const tasks = await due.tasks(ORG).catch(() => []);
  const live = arg('live') ? JSON.parse(fs.readFileSync(arg('live')!, 'utf8')) : null;
  fs.writeFileSync(
    arg('out')!,
    JSON.stringify({ orderDetail: { [o!.id]: order }, shipmentDetail: { [sid]: ship }, genBy: { [sid]: genS, [o!.id]: genO }, process: { [o!.id]: proc }, dashboard, dashboardJa, questions: { threads: dashboard.toConfirm.threads, batches: dashboard.toConfirm.batches ?? [], viewer: { admin: false } }, tasks, customers: [], suppliers: [], aimee: live }),
  );
  const st7 = ship.steps.find((s: any) => s.code === 'CUSTOMS_TAX_ESTIMATE');
  console.log(JSON.stringify({ order: o!.id, sid, step7: st7?.id, cards: dashboard.toConfirm.threads.length }));
  await raw.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
