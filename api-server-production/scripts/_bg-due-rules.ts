/**
 * Round BG — Sayaka's due-date rules per customer (Clients › customer › Process):
 *   SUS   step 2 (Invoice #1) due the 9th of the order's ship month.
 *   Kato  the single invoice (step 11) due 2 days after the shipping documents are received (step 3b done on every
 *         shipment; the latest done date). Shown as "1–2 days".
 * Everyone else unchanged. The dry run lists every open step whose due date / overdue badge moves (old → new).
 * Only the two profiles' dueRules are written (empty before: a typed rule is never overwritten); logged to ActionLog.
 *
 *   DRY RUN (default): DBURL=<url> TENANCY_MODE= npx ts-node --transpile-only scripts/_bg-due-rules.ts
 *   APPLY:             … scripts/_bg-due-rules.ts --apply
 */
import { PrismaClient } from '@prisma/client';
import { TradeDueService } from '../src/shipments/trade-due.service';
import { CustomerDueRule, describeRule } from '../src/shipments/trade-due';

const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const APPLY = process.argv.includes('--apply');
const RULES: Record<string, Record<string, CustomerDueRule>> = {
  SUS: { INVOICE_1: { anchor: 'SHIP_MONTH_DAY', days: 0, day: 9 } },
  KATO: { INVOICE_2: { anchor: 'SHIPPING_DOCS_DONE', days: 2, daysText: '1–2' } },
};
const fmt = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—');

async function main() {
  const url = process.env.DBURL;
  if (!url) throw new Error('DBURL is required');
  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    const org = await p.organization.findFirst({ where: { id: ORG }, select: { name: true } });
    const ts = await p.tradeSetting.findUnique({ where: { organizationId: ORG }, select: { customerProfiles: true } });
    const profiles = (ts?.customerProfiles ?? {}) as Record<string, any>;
    const svc = new TradeDueService(p as any);
    const cfg = await svc.dueConfig(ORG);
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} · ${org?.name} · due dates ${cfg.on ? 'on' : 'OFF'} since ${cfg.since} (badges only on/after it)`);
    const plan: Array<{ id: string; key: string; rules: Record<string, CustomerDueRule> }> = [];
    for (const [key, rules] of Object.entries(RULES)) {
      const hits = Object.entries(profiles).filter(([, v]) => String(v?.key ?? '').toUpperCase() === key);
      if (hits.length !== 1) throw new Error(`expected one ${key} profile, found ${hits.length}`);
      const [id, prof] = hits[0];
      const c = await p.customer.findFirst({ where: { id, organizationId: ORG }, select: { name: true } });
      const cur = prof.dueRules ?? {};
      const clash = Object.keys(rules).filter((code) => cur[code]);
      console.log(`\n${key} · ${c?.name} (${prof.billingMode})`);
      for (const [code, r] of Object.entries(rules)) console.log(`  ${code}: default → "${describeRule(r, 'en')}" / 「${describeRule(r, 'ja')}」${cur[code] ? '  (ALREADY SET — kept)' : ''}`);
      const res = await svc.customerRuleChanges(ORG, id, { ...cur, ...rules });
      console.log(`  open orders: ${res.openOrders}; due dates that change: ${res.changes.length}`);
      for (const ch of res.changes) console.log(`   ${ch.ref.padEnd(7)} step ${ch.no.padEnd(3)} ${fmt(ch.before.due).padEnd(7)} ${(ch.before.badge ?? 'no badge').padEnd(12)} → ${fmt(ch.after.due).padEnd(7)} ${ch.after.badge ?? (ch.after.due && cfg.since && ch.after.due < cfg.since ? 'no badge (before ' + fmt(cfg.since) + ')' : 'no badge')}`);
      if (!clash.length) plan.push({ id, key, rules });
    }
    const others = Object.keys(profiles).length - plan.length;
    console.log(`\nother customer profiles untouched: ${others}`);
    if (!APPLY) return console.log("(dry run — nothing written; add --apply after the owner's go)");
    await p.$transaction(async (tx) => {
      const fresh = await tx.tradeSetting.findUnique({ where: { organizationId: ORG }, select: { customerProfiles: true } });
      const all = { ...((fresh?.customerProfiles ?? {}) as Record<string, any>) };
      for (const x of plan) {
        const from = all[x.id].dueRules ?? {};
        const to = { ...from, ...Object.fromEntries(Object.entries(x.rules).filter(([code]) => !from[code])) };
        all[x.id] = { ...all[x.id], dueRules: to };
        await tx.actionLog.create({
          data: { actorType: 'SYSTEM', actorId: 'system:bg-due-rules', actorName: 'System creation', organizationId: ORG, channel: 'cron', action: 'UPDATE', resource: 'trade-clients', resourceId: x.id, details: { note: `Round BG: ${x.key} due-date rules (Sayaka)`, from, to } },
        });
      }
      await tx.tradeSetting.update({ where: { organizationId: ORG }, data: { customerProfiles: all as any } });
    });
    console.log('applied + logged');
  } finally {
    await p.$disconnect();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
