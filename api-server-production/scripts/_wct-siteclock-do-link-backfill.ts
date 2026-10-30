/**
 * WCT SiteClock "View DO" backfill (2026-10-30). DRY RUN by default
 * (read-only): lists every live SiteClock link that was synced before jobs
 * carried the DO (syncedDoNumber null) with its current SiteClock title and the
 * title + link it would get: "#<run> <customer> · <DO>" and View DO (the DO's
 * view-only /guest/do link). Mints nothing, calls SiteClock read-only.
 *
 *   # prod dry run
 *   TENANCY_MODE= DATABASE_URL=<prod> AIMS_SECRETS_KEY=<prod key> npx ts-node -r tsconfig-paths/register --transpile-only \
 *     scripts/_wct-siteclock-do-link-backfill.ts [--org=<id>]
 *   # apply — only after the owner's go: re-syncs each listed link (the normal
 *   # sync path: mints/reuses the view-only link, PATCHes title + link)
 *   … --apply --confirm-prod
 *
 * Without AIMS_SECRETS_KEY the current SiteClock titles are shown as "?".
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
import { SiteClockModule } from '../src/siteclock/siteclock.module';
import { SiteClockLinkService } from '../src/siteclock/siteclock-link.service';
import { DO_LINK_LABEL, jobTitle } from '../src/siteclock/siteclock-plan';
import { SiteClockClient } from '../src/siteclock/siteclock.client';
import { open } from '../src/common/secret-box';

const ORG = (process.argv.find((a) => a.startsWith('--org='))?.split('=')[1] || '5c700000-0000-4000-8000-5c7000000001').trim();
const APPLY = process.argv.includes('--apply');
const CONFIRM = process.argv.includes('--confirm-prod');

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ActionLogModule, SiteClockModule] })
class M {}

(async () => {
  const host = new URL(process.env.DATABASE_URL || '').hostname;
  if (APPLY && !/^(localhost|127\.0\.0\.1)$/.test(host) && !CONFIRM) throw new Error('--apply on a non-local database needs --confirm-prod');
  const mod = await Test.createTestingModule({ imports: [M] }).compile();
  const prisma = mod.get(PrismaService);
  const link = mod.get(SiteClockLinkService);
  const actionLog = mod.get(ActionLogService);

  await runAsOrg(ORG, async () => {
    const live = { organizationId: ORG, lastPushedStatus: { in: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] } };
    const select = { id: true, deliveryId: true, externalRef: true, lastPushedStatus: true } as const;
    // Before this release is deployed the column doesn't exist yet: then every live link predates it.
    const rows = await prisma.deliverySiteClockJob
      .findMany({ where: { ...live, syncedDoNumber: null }, select, orderBy: { createdAt: 'asc' } })
      .catch((e: any) => {
        if (!/syncedDoNumber/.test(String(e?.message))) throw e;
        console.log('(syncedDoNumber not deployed yet: listing every live link)');
        return prisma.deliverySiteClockJob.findMany({ where: live, select, orderBy: { createdAt: 'asc' } });
      });
    const all = await prisma.deliverySiteClockJob.count({ where: { organizationId: ORG } });
    const conn = await prisma.siteClockConnection.findUnique({ where: { organizationId: ORG } });
    let client: SiteClockClient | null = null;
    try {
      if (conn?.apiKeyEnc && process.env.AIMS_SECRETS_KEY) client = new SiteClockClient({ baseUrl: conn.baseUrl, apiKey: open(conn.apiKeyEnc) });
    } catch {
      client = null;
    }
    console.log(`${ORG}: ${all} SiteClock link(s), ${rows.length} live one(s) synced before jobs carried the DO\n`);
    for (const l of rows) {
      const run: any = await (link as any).loadRunForDryRun(ORG, l.deliveryId);
      const current = client ? (await client.getJob(l.externalRef).then((r) => r.job?.title).catch(() => '?')) : '?';
      const next = run ? jobTitle(run) : '(run deleted — nothing to retitle)';
      console.log(`  ${l.externalRef}  ${l.lastPushedStatus}\n    now:  ${current}\n    new:  ${next}\n    link: ${run?.doUrl ?? (run?.doNumber ? '(a view-only link is minted on apply)' : '(no DO — no link)')}${run?.doUrl || run?.doNumber ? `  "${DO_LINK_LABEL}"` : ''}`);
    }
    if (!APPLY) {
      console.log('\nDRY RUN — nothing written, nothing sent.');
      return;
    }
    for (const l of rows) {
      const r = await link.retry(ORG, l.deliveryId);
      actionLog.system('siteclock-do-link-backfill', 'SYNC', 'deliveries', { organizationId: ORG, resourceId: l.deliveryId, details: { ok: r.ok, error: (r as any).error ?? null } } as any);
      console.log(`  applied ${l.externalRef}: ${r.ok ? 'ok' : `FAILED ${(r as any).error}`}`);
    }
    await new Promise((res) => setTimeout(res, 2000));
  });
  await mod.close();
  process.exit(0);
})().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
