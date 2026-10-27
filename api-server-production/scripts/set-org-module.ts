/**
 * Flip ONE org module on/off and/or set its nav position without re-running
 * the org's whole setup script.
 *
 *   npx ts-node --transpile-only scripts/set-org-module.ts --env prod --org <orgId> --module PROJECTS --enabled false [--sort 2] [--apply]
 */
import { clientsFor, loadEnv, type Env } from './lib/tenancy-clients';

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
    if (!row) throw new Error(`${org.name} has no ${MODULE} module row (it follows MODULE_CATALOG) — run the org setup script instead`);
    const data: any = {};
    if (ENABLED !== undefined) data.enabled = ENABLED === 'true';
    if (SORT !== undefined) data.sortOrder = Number(SORT);
    console.log(`${ENV} · ${org.name} · ${MODULE}: enabled ${row.enabled} → ${data.enabled ?? row.enabled}, sortOrder ${row.sortOrder} → ${data.sortOrder ?? row.sortOrder}${APPLY ? '  *** APPLY ***' : '  (dry run)'}`);
    if (!APPLY) return;
    await plat.organizationModule.update({ where: { id: row.id }, data });
    console.log('saved');
  } finally {
    await disconnect();
  }
})();
