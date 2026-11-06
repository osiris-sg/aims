/**
 * Round BK — READ-ONLY preview fixture of #12 / #12-1 and #18 / #18-1 (step 7 / 8 tax cards) from prod with the new
 * tax inputs (SG→JP total, customs weekly rate). --sgjp12=<ADH20260825 pdf>: #12-1's SG→JP invoice is not filed yet
 * (round BJ go item 5) — its facts are taken from the local PDF, as the filed file would give them. --out=<json>
 */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { OrdersService } from '../src/shipments/orders.service';
import { ShipmentsService } from '../src/shipments/shipments.service';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { TradeGeneratedService } from '../src/shipments/trade-generated.service';
import { S3Service } from '../src/common/services/s3.service';
import { sgjpFileFacts, TradeTaxInputsService } from '../src/shipments/trade-tax-inputs';
import { pdfText } from '../src/shipments/trade-coa';

const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const WRITES = /^(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe|\$transaction)$/;
const readOnly = (p: PrismaClient): any =>
  new Proxy(p as any, {
    get(t, k: string) {
      if (WRITES.test(k)) throw new Error(`read-only: ${k}`);
      const v = t[k];
      if (v && typeof v === 'object' && !k.startsWith('$')) return new Proxy(v, { get: (m, op: string) => { if (WRITES.test(op)) throw new Error(`read-only: ${k}.${op}`); const f = m[op]; return typeof f === 'function' ? f.bind(m) : f; } });
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
(async () => {
  const raw = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  const prisma = readOnly(raw);
  const config = new TradeConfigService(prisma);
  const inputs = new TradeTaxInputsService(prisma, new S3Service({ get: (k: string, d?: string) => process.env[k] ?? d } as any));
  const f12 = sgjpFileFacts(await pdfText(fs.readFileSync(arg('sgjp12')!)), 122.478);
  const cifFor = inputs.cifFor.bind(inputs);
  const out: any = { orderDetail: {}, shipmentDetail: {}, genBy: {}, customers: [], suppliers: [] };
  const ids: any = {};
  for (const no of [12, 18]) {
    const o = await raw.tradeOrder.findFirst({ where: { organizationId: ORG, orderNo: no, isTest: false }, select: { id: true, shipments: { where: { seqNo: 1 }, select: { id: true } } } });
    const sid = o!.shipments[0].id;
    inputs.cifFor = async (org, id, net) => (await cifFor(org, id, net)) ?? (no === 12 && f12.total ? { amount: f12.total, invoiceNo: f12.invoiceNo, invoiceDate: f12.invoiceDate, kind: 'file', ref: 'INVOICE & PACKING LIST_6005_202609納品(7月出荷)_120t_SG-JP.pdf' } : null);
    const ship: any = await new ShipmentsService(prisma, config, undefined, undefined, undefined, inputs).getById(ORG, sid);
    out.orderDetail[o!.id] = await new OrdersService(prisma, config, {} as any).getById(ORG, o!.id);
    out.shipmentDetail[sid] = ship;
    const gen = Object.create(TradeGeneratedService.prototype);
    Object.assign(gen, { prisma, config });
    out.genBy[sid] = await gen.list(ORG, { shipmentId: sid }).catch(() => []);
    out.genBy[o!.id] = await gen.list(ORG, { orderId: o!.id }).catch(() => []);
    ids[no] = { order: o!.id, sid, step7: ship.steps.find((s: any) => s.code === 'CUSTOMS_TAX_ESTIMATE')?.id, step8: ship.steps.find((s: any) => s.code === 'TAX_FUNDS')?.id, est: ship.estimate.importTax.estimate, cif: ship.estimate.importTax.cifUsd, fx: ship.estimate.importTax.fxRate };
  }
  fs.writeFileSync(arg('out')!, JSON.stringify(out));
  console.log(JSON.stringify(ids, null, 1));
  await raw.$disconnect();
})().catch((e) => { console.error(e.stack); process.exit(1); });
