/**
 * Round BJ — READ-ONLY: the SG→JP INVOICE & PACKING LIST draft AIMS would create now for #18-1 (createBlank with a
 * prisma that refuses every write; the final insert is captured instead), rendered to HTML. --out=<html> [--json=<json>]
 */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { TradeGeneratedService } from '../src/shipments/trade-generated.service';
import { S3Service } from '../src/common/services/s3.service';

const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const WRITES = /^(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe|\$transaction)$/;
let captured: any = null;
function readOnly(p: PrismaClient): any {
  return new Proxy(p as any, {
    get(t, k: string) {
      if (WRITES.test(k)) throw new Error(`read-only: ${k}`);
      const v = t[k];
      if (v && typeof v === 'object' && !k.startsWith('$'))
        return new Proxy(v, {
          get: (m, op: string) => {
            if (k === 'tradeGeneratedDoc' && op === 'create') return async (a: any) => ((captured = a.data), a.data);
            if (WRITES.test(op)) throw new Error(`read-only: ${k}.${op}`);
            const f = m[op];
            return typeof f === 'function' ? f.bind(m) : f;
          },
        });
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}
(async () => {
  const raw = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  const prisma = readOnly(raw);
  const config = new TradeConfigService(prisma);
  const s3 = new S3Service({ get: (k: string, d?: string) => process.env[k] ?? d } as any);
  const s = await raw.shipment.findFirst({ where: { organizationId: ORG, order: { orderNo: Number(arg('order') ?? 18), isTest: false }, seqNo: Number(arg('seq') ?? 1) }, select: { id: true } });
  const gen = Object.create(TradeGeneratedService.prototype);
  Object.assign(gen, { prisma, config, s3 });
  await gen.createBlank(ORG, { docType: 'SGJP_IV_PL', shipmentId: s!.id }, { id: 'preview', name: 'Preview' });
  fs.writeFileSync(arg('out')!, gen.render('SGJP_IV_PL', captured.header, captured.columns, captured.rows, { draft: false }));
  if (arg('json')) fs.writeFileSync(arg('json')!, JSON.stringify({ header: captured.header, rows: captured.rows }, null, 1));
  console.log(JSON.stringify(captured.header, null, 1));
  console.log(JSON.stringify(captured.rows));
  await raw.$disconnect();
})().catch((e) => { console.error(e.stack); process.exit(1); });
