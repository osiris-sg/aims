/**
 * Round BJ — READ-ONLY preview fixture: #18 / #18-1 from prod (DBURL inline, TENANCY_MODE=; any write throws) and the
 * new B/L reader's result on #18-1's OBL (one AI read, nothing stored). --out=<json> --obl=<pdf> [--product-hs=7601.20]
 */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { OrdersService } from '../src/shipments/orders.service';
import { ShipmentsService } from '../src/shipments/shipments.service';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { TradeGeneratedService } from '../src/shipments/trade-generated.service';
import { DocumentExtractionService } from '../src/document-extraction/document-extraction.service';
import { BL_SCHEMA, BL_SYSTEM_PROMPT, BL_USER_PROMPT, parseWith, shipmentDraftFromBl, withTextFields } from '../src/shipments/trade-extract.rules';
import { pdfText } from '../src/shipments/trade-coa';
import { hsWarning } from '../src/shipments/trade-hs';

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
  const o = await raw.tradeOrder.findFirst({ where: { organizationId: ORG, orderNo: 18 }, select: { id: true, shipments: { where: { seqNo: 1 }, select: { id: true } } } });
  const sid = o!.shipments[0].id;
  const order = await new OrdersService(prisma, config, {} as any).getById(ORG, o!.id);
  const ship: any = await new ShipmentsService(prisma, config).getById(ORG, sid);
  const gen = Object.create(TradeGeneratedService.prototype);
  Object.assign(gen, { prisma, config });
  const genS = await gen.list(ORG, { shipmentId: sid }).catch(() => []);
  const genO = await gen.list(ORG, { orderId: o!.id }).catch(() => []);
  // The new reader on the OBL (AI + text layer), as blResult builds it; the product HS as after the seed (--product-hs).
  const buf = fs.readFileSync(arg('obl')!);
  const x = Object.create(DocumentExtractionService.prototype) as DocumentExtractionService;
  Object.assign(x, { logger: { log() {}, warn() {}, error() {} } });
  const ai = await x.extractStructured({ buffer: buf, mimetype: 'application/pdf' }, BL_SYSTEM_PROMPT, BL_USER_PROMPT, { maxTokens: 4000 });
  const bl = withTextFields(parseWith(BL_SCHEMA, ai.data, 'B/L'), await pdfText(buf).catch(() => ''));
  const draft: any = shipmentDraftFromBl(bl);
  const productHs = arg('product-hs') ?? null;
  draft.hsCodeFrom = draft.hsCode ? 'bl' : null;
  if (productHs) ship.productHs = { hsCode: productHs, product: '6005 billet 203 × 5800', party: 'customer' };
  const extraction = {
    id: 'preview-x', fileId: 'preview-obl', kind: 'BL_DRAFT', status: 'DONE', error: null, model: ai.model, inputTokens: ai.inputTokens, outputTokens: ai.outputTokens, durationMs: 0, costUsd: 0, createdAt: new Date().toISOString(),
    file: { id: 'preview-obl', fileName: 'OBL_6005_8inch_198GX06322_183.693_MT.pdf' },
    result: { raw: bl, draft, contractId: ship.contractId, contractLineId: ship.contractLineId, existingShipmentId: sid, productHs, hsWarning: hsWarning(draft.hsCode, productHs) },
  };
  fs.writeFileSync(arg('out')!, JSON.stringify({ orderDetail: { [o!.id]: order }, shipmentDetail: { [sid]: ship }, genBy: { [sid]: genS, [o!.id]: genO }, customers: [], suppliers: [], extraction }));
  console.log(JSON.stringify({ order: o!.id, sid, step3a: ship.steps.find((s: any) => s.code === 'BL_DRAFT_APPROVAL')?.id, draft: { pod: draft.portOfDischarge, cc: draft.containerCount, hs: draft.hsCode, coo: draft.countryOfOrigin, por: draft.placeOfReceipt } }));
  await raw.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
