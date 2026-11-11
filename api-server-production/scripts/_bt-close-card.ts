/**
 * Round BT — close the "請求書送付 12月 アルミビレット" card (email 8c06e16f…) as "Already filed": every attachment's bytes
 * are already in AIMS (#22 step 11, #28 step 2, #27 step 2). Nothing is filed. Dry run lists where each file is;
 * --apply runs EmailTriageService.closeIfAllFiled (inboxState PROCESSED + Activity Log row).
 *   DBURL=<prod url> TENANCY_MODE= npx ts-node -r tsconfig-paths/register --transpile-only scripts/_bt-close-card.ts [--apply]
 */
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { S3Service } from '../src/common/services/s3.service';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { EmailTriageService } from '../src/ingestion-email/email-triage.service';

const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const EMAIL = '8c06e16f-b1f0-4b26-9652-e3d396be29a4';
const APPLY = process.argv.includes('--apply');
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  if (!APPLY) await p.$executeRawUnsafe('SET default_transaction_read_only = on');
  const actionLog = {
    system: (job: string, action: string, resource: string, o: any) =>
      p.actionLog.create({ data: { actorType: 'SYSTEM', actorId: 'system:round-bt-close-card', actorName: 'System creation', organizationId: ORG, channel: 'script', action, resource, resourceId: o.resourceId ?? null, details: { job, go: 'owner 2026-11-11 (round BT item 2)', ...(o.details ?? {}) } as any } }).catch((e) => console.error('log failed', e.message)),
  } as any;
  const t = new EmailTriageService(p as any, new S3Service(new ConfigService()), {} as any, new TradeConfigService(p as any), {} as any, actionLog);
  const pl = await t.placements(ORG, [EMAIL], []);
  for (const f of pl.files) console.log(`${f.name} → ${(f as any).filed.map((x: any) => `${x.ref} · step ${x.step}`).join(', ') || 'NOT filed'}`);
  console.log(`allFiled: ${pl.allFiled}`);
  if (APPLY) {
    const r = await t.closeIfAllFiled(ORG, EMAIL, { id: 'system:round-bt-close-card', name: 'System creation (owner go)' } as any);
    console.log(r ? `closed: ${JSON.stringify(r)}` : 'NOT closed');
    await new Promise((res) => setTimeout(res, 1500));
  }
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
