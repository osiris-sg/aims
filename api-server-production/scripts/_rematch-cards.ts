import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { PushModule } from '../src/push/push.module';
import { ClerkModule } from '../src/clerk/clerk.module';
import { IngestionEmailModule } from '../src/ingestion-email/ingestion-email.module';
import { EmailTriageService } from '../src/ingestion-email/email-triage.service';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, ActionLogModule, PushModule, IngestionEmailModule] })
class M {}
const ORG = process.argv[2];
async function main() {
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const triage = app.get(EmailTriageService); const prisma = app.get(PrismaService);
  await runAsOrg(ORG, async () => {
    const rows: any[] = await prisma.emailIngestLog.findMany({ where: { organizationId: ORG, inboxState: { in: ['SUGGESTED', 'UNMATCHED', 'UNSURE'] } }, select: { id: true, subject: true, inboxState: true, actions: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
    for (const r of rows) {
      const re: any = await triage.rematchStored(ORG, r.id, process.argv.includes('--apply')).catch((e) => ({ err: e.message }));
      const v = re?.verdict ?? re?.backlog ?? null;
      console.log(`${r.createdAt.toISOString().slice(0, 10)} ${String(r.inboxState).padEnd(9)} "${(r.subject ?? '').slice(0, 50)}" · now ${r.actions?.backlog?.kind ?? '-'} → ${process.argv.includes('--apply') ? 'applied' : 'dry'} ${re?.err ?? `${v?.kind} (${(v?.reason ?? '').slice(0, 60)})`}`);
    }
  });
  await app.close();
}
main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(), 200));
