/** Round BT — READ-ONLY: re-match one email with the new card code (dry run, every write throws) and print the card. */
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { S3Service } from '../src/common/services/s3.service';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { TradeStepsService } from '../src/shipments/trade-steps.service';
import { EmailTriageService } from '../src/ingestion-email/email-triage.service';
import { questionOf } from '../src/ingestion-email/email-question';
const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const WRITES = /^(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe|\$transaction)$/;
const ro = (p: any): any => new Proxy(p, { get(t, k: string) { if (WRITES.test(k)) throw new Error(`read-only: ${k}`); const v = t[k]; if (v && typeof v === 'object' && !k.startsWith('$')) return new Proxy(v, { get: (m: any, op: string) => { if (WRITES.test(op)) throw new Error(`read-only: ${k}.${op}`); const f = m[op]; return typeof f === 'function' ? f.bind(m) : f; } }); return typeof v === 'function' ? v.bind(t) : v; } });
(async () => {
  const raw = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  const prisma = ro(raw);
  const config = new TradeConfigService(prisma);
  const t = new EmailTriageService(prisma, new S3Service(new ConfigService()), {} as any, config, new TradeStepsService(prisma, config), { system: () => undefined } as any);
  const id = process.argv[2];
  const log: any = await raw.emailIngestLog.findFirst({ where: { id, organizationId: ORG } });
  let card: any = null;
  await (t as any).matchAndPlan(ORG, id, (log.triage ?? {}).keys ?? {}, 'PARTIAL_AUTO', undefined, { dryRun: true, noReasoner: true, capture: (p: any) => (card = p.card) });
  console.log(JSON.stringify({ allFiled: card?.allFiled, invoices: card?.invoices, invoiceSplit: card?.invoiceSplit, guess: card?.guess }, null, 1));
  for (const lang of ['en', 'ja'] as const) {
    const q = questionOf({ lang, reasonCode: 'PICK_SHIPMENT', subject: log.subject, company: 'Asia Deal Hub', attachments: [], keys: {}, threadSize: 1, suggested: null, candidates: [], check: [], summaryOf: () => null, refOf: (o: string) => `#${o.slice(0, 4)}`, emails: 1, card } as any);
    console.log(`${lang}: ${q.headline}\n  ${q.evidence.map((e: any) => e.text).join('\n  ')}`);
  }
  await raw.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
