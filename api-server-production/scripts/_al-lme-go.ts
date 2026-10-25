/** Round AL — owner's go: enableLmeFeed ON for ADH, then "Fetch now" (MANUAL). Snapshots every org before/after. */
import 'dotenv/config';
import { createHash } from 'crypto';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { PushModule } from '../src/push/push.module';
import { ShipmentsModule } from '../src/shipments/shipments.module';
import { LmeFeedService } from '../src/shipments/lme-feed.service';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), PushModule, ActionLogModule, ShipmentsModule] })
class M {}
const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const APPLY = process.argv.includes('--apply');
const h = (v: unknown) => createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 12);
const usd = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
(async () => {
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const prisma: any = app.get(PrismaService);
  const lme = app.get(LmeFeedService);
  const snap = async () => {
    const ts = await prisma.tradeSetting.findMany({ select: { organizationId: true, docDefaults: true, updatedAt: true } });
    const ui = await prisma.organizationUIConfig.findMany({ select: { organizationId: true, features: true } });
    const alerts = await prisma.tradeAlert.groupBy({ by: ['organizationId'], _count: true });
    const m = new Map<string, string>();
    for (const t of ts) m.set(`ts:${t.organizationId}`, h(t.docDefaults));
    for (const u of ui) m.set(`ui:${u.organizationId}`, h(u.features));
    for (const a of alerts) m.set(`alerts:${a.organizationId}`, String(a._count));
    return m;
  };
  const before = await snap();
  console.log(`snapshot: ${before.size} rows (trade settings, UI configs, alert counts)`);
  const ui = await prisma.organizationUIConfig.findUnique({ where: { organizationId: ADH }, select: { features: true } });
  const feats = (ui?.features as Record<string, unknown>) ?? {};
  console.log('ADH enableLmeFeed now:', feats.enableLmeFeed ?? '(unset)');
  if (!APPLY) { console.log('dry run — add --apply'); await app.close(); return; }
  await prisma.organizationUIConfig.update({ where: { organizationId: ADH }, data: { features: { ...feats, enableLmeFeed: true } } });
  await prisma.actionLog.create({ data: { actorType: 'SYSTEM', actorId: 'system:round-al-lme-go', actorName: 'System creation', organizationId: ADH, channel: 'operator', action: 'UPDATE', resource: 'OrganizationUIConfig', resourceId: ADH, details: { note: "Owner's go (2026-10-25): enableLmeFeed switched ON for ADH", enableLmeFeed: { from: feats.enableLmeFeed ?? null, to: true } } } });
  console.log('flag ON; switched-on orgs:', (await lme.switchedOnOrgs()).length);
  const r = await lme.run('MANUAL', { apply: true, onlyOrg: ADH });
  console.log(`run ok=${r.ok} apply=${r.apply} latest=${r.latest} quotesWritten=${r.quotesWritten} ${r.error ?? ''}`);
  const o = r.orgs[0];
  console.log('writes:', o?.plan.writes.map((w) => `${w.month}=${w.to}${w.final ? '' : ' (prov)'}`).join(', '), '| conflicts:', o?.plan.conflicts.length, '| revise:', o?.revise.length);
  const st: any = await runAsOrg(ADH, () => lme.status(ADH));
  console.log('\nmonth | Westmetall | days | final | AIMS table | state');
  for (const m of [...st.months].reverse()) console.log(`${m.month} | ${usd(m.westmetall)} | ${m.days} | ${m.final ? 'final' : 'provisional'} | ${usd(m.table)} | ${m.state}`);
  console.log('provisional:', st.provisional.join(','), '| last run:', st.lastRun?.createdAt?.toISOString?.() ?? st.lastRun?.createdAt, st.lastRun?.ok);
  const after = await snap();
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter((k) => before.get(k) !== after.get(k));
  console.log('\nchanged rows:', changed.map((k) => k.replace(ADH, 'ADH')).join(', ') || 'none');
  console.log('other orgs changed:', changed.filter((k) => !k.endsWith(ADH)).length);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
