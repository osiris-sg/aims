/**
 * Round BS — READ-ONLY preview fixture for the screenshots: the "請求書送付 12月 アルミビレット" card (its thread, the
 * Answer flow's file placements computed by the round BS code), the open / completed shipment and order lists, from
 * prod (DBURL inline, TENANCY_MODE=; every write throws). --out=<json> [--email=<id>]
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
  const emailId = arg('email') ?? '8c06e16f-b1f0-4b26-9652-e3d396be29a4';
  const dash = await triage.dashboard(ORG, 'en', { admin: false });
  const dashJa = await triage.dashboard(ORG, 'ja', { admin: false });
  const find = (d: any) => d.toConfirm.threads.find((t: any) => t.messages.some((m: any) => m.id === emailId) || (t.answerIds ?? []).includes(emailId));
  const thread = find(dash);
  const threadJa = find(dashJa);
  const placements = await triage.placements(ORG, [emailId], []);
  const shipsOpen = await shipments.list(ORG, { status: 'OPEN', pageSize: 200 } as any);
  const shipsDone = await shipments.list(ORG, { status: 'COMPLETED', pageSize: 200 } as any);
  const ord = await orders.list(ORG, { bucket: 'all', pageSize: 200 } as any);
  fs.writeFileSync(arg('out')!, JSON.stringify({ answer: { thread, placements, shipsOpen, shipsDone, orders: ord }, answerJa: { thread: threadJa }, questions: { threads: dash.toConfirm.threads, batches: dash.toConfirm.batches ?? [], viewer: { admin: false } }, customers: [], suppliers: [] }));
  console.log(JSON.stringify({ card: !!thread, cardState: thread ? thread.messages.map((m: any) => m.inboxState) : null, question: thread?.question?.kind ?? null, guess: thread?.question?.options?.slice(0, 3).map((o: any) => `${o.ref} (${o.why})`), outgoing: placements.outgoing, allFiled: placements.allFiled, files: placements.files.map((f: any) => ({ name: f.name, docType: f.docType, default: f.defaults.map((d: any) => `${d.ref} — ${d.why}`), filed: f.filed.map((x: any) => `${x.ref} · step ${x.step} (${x.docType})`) })) }, null, 1));
  await raw.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
