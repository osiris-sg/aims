/**
 * Round R correction (ADH only, dry run unless --apply): emails hidden as "auto-reply (auto-submitted)" whose raw
 * MIME says Auto-Submitted: auto-generated (the mailbox forwarding rule) and carries no X-Autoreply are NOT
 * auto-replies — unhide them (back to the inbox, matched again with today's rules, never auto-applied; a person's
 * unhide flag keeps them from being hidden again). Prints from-domain + subject 60 only.
 */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { ActionLogService } from '../src/action-log/action-log.service';
import { PushModule } from '../src/push/push.module';
import { ClerkModule } from '../src/clerk/clerk.module';
import { IngestionEmailModule } from '../src/ingestion-email/ingestion-email.module';
import { EmailTriageService } from '../src/ingestion-email/email-triage.service';
import { PrismaService } from '../src/common/prisma.service';
import { S3Service } from '../src/common/services/s3.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { threadHeadersFromEml } from '../src/ingestion-email/email-threads';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, ActionLogModule, PushModule, IngestionEmailModule] })
class M {}
const ORG = process.argv.find((a) => a.startsWith('--org='))?.slice(6)!;
const APPLY = process.argv.includes('--apply');
const domainOf = (from: string | null | undefined) => (/@([^>\s]+)/.exec(from ?? '')?.[1] ?? '?').toLowerCase().replace(/[>;,]+$/, '');
const subject60 = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);

async function main() {
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const triage = app.get(EmailTriageService);
  const s3 = app.get(S3Service);
  const actionLog = app.get(ActionLogService);
  await runAsOrg(ORG, async () => {
    const rows: any[] = await prisma.emailIngestLog.findMany({ where: { organizationId: ORG, inboxState: 'HIDDEN' }, orderBy: { createdAt: 'asc' } });
    let n = 0;
    for (const r of rows) {
      const reason: string = r.actions?.backlog?.reason ?? '';
      if (!/auto-submitted/.test(reason)) continue;
      const key = r.rawMeta?.emlKey;
      if (!key) continue;
      const head = (await s3.downloadFile(key)).subarray(0, 32_000).toString('latin1');
      const th = threadHeadersFromEml(head); // today's rule: auto-replied / X-Autoreply only
      const label = `${domainOf(r.fromAddress).padEnd(20)} | ${subject60(r.subject)}`;
      if (th.autoSubmitted) {
        console.log(`  keep hidden (genuine auto-reply): ${label}`);
        continue;
      }
      console.log(`${APPLY ? '↩' : '·'} unhide: ${label}`);
      n++;
      if (APPLY) {
        await prisma.emailIngestLog.update({ where: { id: r.id }, data: { rawMeta: { ...(r.rawMeta as object), autoSubmitted: false } as any } });
        const row = await triage.unhide(ORG, r.id);
        console.log(`    → ${row.inboxState}${row.matched ? ` · ${row.matched}` : ''}`);
        actionLog.system('email-unhide', 'UPDATE', 'EmailIngestLog', { organizationId: ORG, resourceId: r.id, details: { reason: 'forwarded mail stamped auto-generated, not an auto-reply', inboxState: row.inboxState } });
      }
    }
    console.log(`\n${n} to unhide · ${APPLY ? 'APPLIED' : 'DRY RUN'}`);
  });
  await app.close();
}
main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(), 200));
