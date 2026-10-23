/**
 * Drop "Stock Card" from the SALES module's sub-menus for EVERY org (guru
 * 2026-10-24: "remove stock card from sales tab for all orgs"). Stock Card stays
 * under Inventory. Orgs without a SALES row follow MODULE_CATALOG, where the
 * entry is gone; orgs WITH a row carry their own subMenus copy, fixed here.
 * The /portal/sales/stock-card page stays reachable by URL.
 *
 *   npx ts-node --transpile-only scripts/retire-sales-stock-card.ts --env dev|staging|prod [--apply]
 */
import { clientsFor, loadEnv, type Env } from './lib/tenancy-clients';

const args = process.argv.slice(2);
const argVal = (k: string, d?: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const ENV = (argVal('--env', 'dev') || 'dev') as Env;
const APPLY = args.includes('--apply');
const DROP = 'stock-card';

loadEnv(ENV);
const { plat, disconnect } = clientsFor(ENV, 'org_chongaik');

(async () => {
  const rows = await plat.organizationModule.findMany({
    where: { moduleCode: 'SALES' },
    include: { organization: { select: { name: true } } },
    orderBy: { organization: { name: 'asc' } },
  });
  const orgCount = await plat.organization.count();
  console.log(`${ENV} · ${orgCount} orgs · ${rows.length} SALES rows${APPLY ? ' · *** APPLY ***' : ' · dry run'}`);
  const keyOf = (m: any) => (typeof m === 'string' ? m : m?.key);
  let changed = 0;
  for (const r of rows) {
    const config: any = r.config ?? {};
    const subMenus: any[] | undefined = config.subMenus;
    const name = (r.organization?.name ?? r.organizationId).padEnd(36);
    if (!Array.isArray(subMenus)) { console.log(`  ${name} no subMenus (follows catalog)`); continue; }
    if (!subMenus.some((m) => keyOf(m) === DROP)) { console.log(`  ${name} already without ${DROP}`); continue; }
    const next = subMenus.filter((m) => keyOf(m) !== DROP);
    console.log(`  ${name} drop ${DROP} → ${next.map(keyOf).join(', ')}`);
    changed++;
    if (APPLY) await plat.organizationModule.update({ where: { id: r.id }, data: { config: { ...config, subMenus: next } } });
  }
  console.log(`${APPLY ? 'updated' : 'would update'} ${changed} row(s)`);
  await disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
