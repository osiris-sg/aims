/**
 * Flip ONE org module on/off and/or set its nav position without re-running
 * the org's whole setup script. When the org has no row for the module (it
 * was following MODULE_CATALOG's default) the row is created from the catalog
 * entry so the override sticks (Chong Aik: Orders + Deliveries off, 2026-11-13).
 *
 *   npx ts-node --transpile-only scripts/set-org-module.ts --env prod --org <orgId> --module PROJECTS --enabled false [--sort 2] [--apply]
 */
import { clientsFor, loadEnv, type Env } from './lib/tenancy-clients';
import { getCatalogModule } from '../src/configuration/module-catalog';

const args = process.argv.slice(2);
const argVal = (k: string, d?: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const ENV = (argVal('--env', 'dev') || 'dev') as Env;
const ORG = argVal('--org');
const MODULE = argVal('--module');
const ENABLED = argVal('--enabled');
const SORT = argVal('--sort');
const APPLY = args.includes('--apply');
if (!ORG || !MODULE || (ENABLED === undefined && SORT === undefined)) throw new Error('--org, --module and --enabled and/or --sort are required');
loadEnv(ENV);

(async () => {
  const { plat, disconnect } = clientsFor(ENV, 'org_wct');
  try {
    const org = await plat.organization.findUnique({ where: { id: ORG }, select: { name: true } });
    if (!org) throw new Error('org not found');
    const row: any = await plat.organizationModule.findFirst({ where: { organizationId: ORG, moduleCode: MODULE } });
    const cat = getCatalogModule(MODULE);
    if (!row && !cat) throw new Error(`${org.name} has no ${MODULE} module row and MODULE_CATALOG has no such module`);
    const cur = row ?? { enabled: cat!.defaultEnabled, sortOrder: cat!.sortOrder };
    const data: any = {};
    if (ENABLED !== undefined) data.enabled = ENABLED === 'true';
    if (SORT !== undefined) data.sortOrder = Number(SORT);
    console.log(`${ENV} · ${org.name} · ${MODULE}${row ? '' : ' (no row yet — follows the catalog; row will be created)'}: enabled ${cur.enabled} → ${data.enabled ?? cur.enabled}, sortOrder ${cur.sortOrder} → ${data.sortOrder ?? cur.sortOrder}${APPLY ? '  *** APPLY ***' : '  (dry run)'}`);
    if (!APPLY) return;
    if (row) await plat.organizationModule.update({ where: { id: row.id }, data });
    else
      await plat.organizationModule.create({
        data: { organizationId: ORG, moduleCode: MODULE, displayName: cat!.displayName, icon: cat!.icon, config: cat!.config, enabled: cat!.defaultEnabled, sortOrder: cat!.sortOrder, ...data },
      });
    console.log('saved');
  } finally {
    await disconnect();
  }
})();
