/**
 * WCT real DO numbers (2026-10-30): existing DO-PENDING-NN placeholders → real
 * numbers. DRY RUN by default (read-only): lists every placeholder of the org
 * with its run and the number it WOULD get if applied now. Nothing is claimed.
 *
 *   # prod dry run (read-only)
 *   TENANCY_MODE= DATABASE_URL=<prod> npx ts-node -r tsconfig-paths/register --transpile-only \
 *     scripts/_wct-do-pending-backfill.ts [--org=<id>]
 *   # apply — only after the owner's go
 *   … scripts/_wct-do-pending-backfill.ts --apply --confirm-prod
 *
 * Apply, per placeholder (oldest first): the real number is claimed through the
 * same path a run's completion uses (DocumentsService.claimPendingNumber), the
 * DO is stamped issuedOnSchedule (so a later cancel keeps it as Cancelled), and
 * one Activity Log row (System) is written per DO. Its SiteClock job, if any,
 * re-titles on its next sync. Never deletes, never touches another org or a
 * non-placeholder document. --apply on a non-local DB needs --confirm-prod.
 */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from '../config/configuration';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { ActionLogService } from '../src/action-log/action-log.service';
import { ClerkModule } from '../src/clerk/clerk.module';
import { PushModule } from '../src/push/push.module';
import { PushService } from '../src/push/push.service';
import { StaffWhatsAppService } from '../src/staff-whatsapp/staff-whatsapp.service';
import { DocumentsModule } from '../src/documents/documents.module';
import { DocumentsService } from '../src/documents/documents.service';
import { DocumentNumberingService } from '../src/document-numbering/document-numbering.service';

const ORG = (process.argv.find((a) => a.startsWith('--org='))?.split('=')[1] || '5c700000-0000-4000-8000-5c7000000001').trim();
const APPLY = process.argv.includes('--apply');
const CONFIRM = process.argv.includes('--confirm-prod');

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, PushModule, ActionLogModule, DocumentsModule] })
class M {}

const silent = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : async () => undefined) });

(async () => {
  const host = new URL(process.env.DATABASE_URL || '').hostname;
  const local = /^(localhost|127\.0\.0\.1)$/.test(host);
  if (APPLY && !local && !CONFIRM) throw new Error('--apply on a non-local database needs --confirm-prod');
  const mod = await Test.createTestingModule({ imports: [M] })
    .overrideProvider(StaffWhatsAppService)
    .useValue(silent)
    .overrideProvider(PushService)
    .useValue(silent)
    .compile();
  const prisma = mod.get(PrismaService);
  const documents = mod.get(DocumentsService);
  const numbering = mod.get(DocumentNumberingService);
  const actionLog = mod.get(ActionLogService);

  await runAsOrg(ORG, async () => {
    const org = await prisma.organization.findUnique({ where: { id: ORG }, select: { name: true } });
    const docs = await prisma.document.findMany({
      where: { organizationId: ORG, type: 'DELIVERY_ORDER', name: { startsWith: 'DO-PENDING-' } },
      select: { id: true, name: true, status: true, createdAt: true, documentTemplateId: true, config: true },
      orderBy: { createdAt: 'asc' },
    });
    const items = docs.length
      ? await prisma.deliveryItem.findMany({ where: { documentId: { in: docs.map((d) => d.id) } }, select: { documentId: true, deliveryId: true } })
      : [];
    const runIds = [...new Set(items.map((i) => i.deliveryId))];
    const runs = runIds.length
      ? await prisma.delivery.findMany({ where: { id: { in: runIds }, organizationId: ORG }, select: { id: true, deliveryNumber: true, status: true, scheduledFor: true, isDraft: true, customer: { select: { name: true } } } })
      : [];
    const runOf = (docId: string) => runs.find((r) => items.some((i) => i.documentId === docId && i.deliveryId === r.id));
    // What the counter would hand out now, in order (preview only — nothing is claimed).
    const fmt = (await numbering.list(ORG, 'DELIVERY_ORDER')).find((f: any) => f.isActive);
    const proposals = fmt ? previewSeries(fmt.preview, docs.length) : docs.map(() => '(legacy prefix + serial)');

    console.log(`${org?.name ?? ORG}: ${docs.length} placeholder DO(s)${fmt ? ` · format ${fmt.pattern}, next ${fmt.preview}` : ''}\n`);
    docs.forEach((d, i) => {
      const r = runOf(d.id);
      console.log(
        `  ${d.name.padEnd(15)} → ${proposals[i].padEnd(14)} ${d.status.padEnd(12)} created ${d.createdAt.toISOString().slice(0, 10)}  ` +
          (r ? `run #${r.deliveryNumber} ${r.status}${r.isDraft ? ' (draft)' : ''}, ${r.scheduledFor?.toISOString().slice(0, 16) ?? 'no date'} UTC, ${r.customer?.name ?? '—'}` : 'no run'),
      );
    });
    if (!APPLY) {
      console.log(`\nDRY RUN — nothing written. Numbers are what the counter gives NOW; an apply claims them at that moment (a DO scheduled in between takes the next one first).`);
      return;
    }
    for (const d of docs) {
      const real = await documents.claimPendingNumber(d.id, ORG);
      if (!real || /PENDING/.test(real)) throw new Error(`claim failed for ${d.name}`);
      const cur = await prisma.document.findFirst({ where: { id: d.id, organizationId: ORG }, select: { config: true } });
      await prisma.document.update({ where: { id: d.id }, data: { config: { ...((cur?.config as any) || {}), issuedOnSchedule: true } } });
      actionLog.system('do-pending-backfill', 'UPDATE', 'documents', { organizationId: ORG, resourceId: d.id, details: { from: d.name, to: real, run: runOf(d.id)?.deliveryNumber ?? null } } as any);
      console.log(`  applied: ${d.name} → ${real}`);
    }
    await new Promise((r) => setTimeout(r, 2000)); // let the Activity Log writes land
  });
  await mod.close();
  process.exit(0);
})().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});

/** DO202610007, DO202610008, … from the preview (the trailing digit run is the serial). */
function previewSeries(first: string, n: number): string[] {
  const m = first.match(/^(.*?)(\d+)$/);
  if (!m) return Array.from({ length: n }, () => first);
  const [, head, digits] = m;
  return Array.from({ length: n }, (_, i) => `${head}${String(Number(digits) + i).padStart(digits.length, '0')}`);
}
