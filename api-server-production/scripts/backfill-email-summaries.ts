/**
 * Round AB — one-line email summaries for the open questions (Unprocessed inbox rows without `triage.summary`).
 * New mail gets its summary from the triage call itself; this fills the rows that were triaged before round AB.
 *
 *   DATABASE_URL=<db> TENANCY_MODE=<mode> npx ts-node -r tsconfig-paths/register --transpile-only \
 *     scripts/backfill-email-summaries.ts --org=<organization id> [--apply] [--limit=50] [--all | --long]
 *
 * Round AC: summaries are stored in English AND Japanese (the card shows the viewer's language); --all re-summarises
 * every open question (also rows that already have one) and prints before → after (the English card text).
 *
 * Without --apply nothing is written: the work list (from-domain + subject 60) and the summary each row WOULD get.
 * The summary is display text only (email content is untrusted — it never drives an action); printed here as the
 * first 80 characters so the operator can eyeball it.
 */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { ActionLogService } from '../src/action-log/action-log.service';
import { ClerkModule } from '../src/clerk/clerk.module';
import { PushModule } from '../src/push/push.module';
import { IngestionEmailModule } from '../src/ingestion-email/ingestion-email.module';
import { EmailTriageService } from '../src/ingestion-email/email-triage.service';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, PushModule, ActionLogModule, IngestionEmailModule] })
class BackfillModule {}

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ORG = arg('org')!;
const APPLY = process.argv.includes('--apply');
const LIMIT = Number(arg('limit') ?? 50);
const ALL = process.argv.includes('--all');
/** Round AD: only the stored summaries that run over the owner's limit (~20 words EN / ~40 characters a clause JA), open AND processed rows of the last 60 days. */
const LONG = process.argv.includes('--long');

async function main() {
  if (!ORG || !/^[0-9a-f-]{36}$/i.test(ORG)) throw new Error('--org=<organization id> is required');
  const app = await NestFactory.createApplicationContext(BackfillModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const triage = app.get(EmailTriageService);
  const actionLog = app.get(ActionLogService);
  const org = await prisma.organization.findUnique({ where: { id: ORG }, select: { name: true } });
  if (!org) throw new Error(`org ${ORG} not found`);
  console.log(`org: ${org.name} · mode: ${APPLY ? 'APPLY' : 'DRY RUN (nothing written)'}`);
  const counts = { ai: 0, fallback: 0, none: 0 };
  await runAsOrg(ORG, async () => {
    const missing = await triage.summariesMissing(ORG, LONG ? 'long' : ALL ? 'all' : 'missing');
    console.log(`${LONG ? 'emails whose summary runs over the limit' : `open questions ${ALL ? '(all, re-summarised)' : 'without a summary'}`}: ${missing.length}${missing.length > LIMIT ? ` (doing ${LIMIT})` : ''}\n`);
    for (const m of missing.slice(0, LIMIT)) {
      const r = await triage.summarize(ORG, m.id, { dryRun: !APPLY, force: ALL || LONG });
      counts[r.source === 'stored' ? 'ai' : r.source]++;
      console.log(`${APPLY ? (r.stored ? 'stored ' : 'skipped') : 'would  '} ${r.source.padEnd(8)} ${m.fromDomain.padEnd(24)} "${m.subject60}"\n         before: ${r.before ?? '(none)'}\n         en:     ${r.en ?? '(none)'}\n         ja:     ${r.ja ?? '(none)'}`);
    }
  });
  if (APPLY) await actionLog.system('backfill-email-summaries', 'UPDATE', 'EmailIngestLog', { organizationId: ORG, details: counts });
  console.log(`\n${APPLY ? '' : 'would: '}ai ${counts.ai} · fallback ${counts.fallback} · none ${counts.none}`);
  await app.close();
}

main()
  .catch((e) => { console.error(e?.message ?? e); process.exitCode = 1; })
  .finally(() => setTimeout(() => process.exit(), 200));
