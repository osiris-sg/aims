/** Round AK — LME feed dry run (prod-safe: run('SCRIPT', { apply: false }) writes nothing). Prints the table plan for ADH. */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { PushModule } from '../src/push/push.module';
import { ShipmentsModule } from '../src/shipments/shipments.module';
import { LmeFeedService } from '../src/shipments/lme-feed.service';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), PushModule, ActionLogModule, ShipmentsModule] })
class M {}
const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const usd = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
(async () => {
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const svc = app.get(LmeFeedService);
  const APPLY = process.argv.includes('--apply-dev');
  if (APPLY && process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) throw new Error('--apply-dev is for the dev DB only');
  const r = await svc.run('SCRIPT', { apply: APPLY, onlyOrg: process.argv.find((a) => a.startsWith('--org='))?.slice(6) ?? ADH });
  console.log(`ok=${r.ok} apply=${r.apply} days=${r.days} latest=${r.latest} newlyFinal=${r.newlyFinal.join(',')} publishedMismatch=${JSON.stringify(r.publishedMismatch)} ${r.error ?? ''}`);
  console.log('switched-on orgs:', (await svc.switchedOnOrgs()).length);
  for (const o of r.orgs) {
    console.log(`\norg ${o.organizationId === ADH ? 'ADH' : o.organizationId}`);
    console.log('month | Westmetall | days | status | AIMS table now | action');
    const w = new Map(o.plan.writes.map((x) => [x.month, x]));
    const c = new Map(o.plan.conflicts.map((x) => [x.month, x]));
    for (const m of r.months.filter((m) => m.month >= '2026-01')) {
      const wr = w.get(m.month), cf = c.get(m.month);
      const now = wr?.from ?? cf?.table ?? (o.plan.agree.includes(m.month) ? m.avg : null);
      const action = wr ? `FILL ${usd(wr.to)}${wr.final ? '' : ' (provisional)'}` : cf ? `KEEP typed — differs by ${usd(cf.table - cf.westmetall)}` : o.plan.agree.includes(m.month) ? 'keep (typed, agrees)' : 'keep';
      console.log(`${m.month} | ${usd(m.avg)} | ${m.days} | ${m.final ? 'final' : 'provisional'} | ${usd(now)} | ${action}`);
    }
    console.log(`revise tasks (${o.revise.length}):`);
    for (const t of o.revise) console.log(`  ${t.ref} · ${t.docLabel} · used ${usd(t.used)} · final ${usd(t.final)} (${t.month})`);
  }
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
