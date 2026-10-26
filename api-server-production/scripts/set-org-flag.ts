/**
 * Flip ONE per-org feature flag (OrganizationUIConfig.features) without
 * re-running an org's whole setup script.
 *
 *   npx ts-node --transpile-only scripts/set-org-flag.ts --env prod --org <orgId> --flag enablePostingQueue --value false [--apply]
 */
import { clientsFor, loadEnv, type Env } from './lib/tenancy-clients';

const args = process.argv.slice(2);
const argVal = (k: string, d?: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const ENV = (argVal('--env', 'dev') || 'dev') as Env;
const ORG = argVal('--org');
const FLAG = argVal('--flag');
const VALUE = argVal('--value');
const APPLY = args.includes('--apply');
if (!ORG || !FLAG || VALUE === undefined) throw new Error('--org, --flag and --value are required');
const value = VALUE === 'true' ? true : VALUE === 'false' ? false : VALUE;
loadEnv(ENV);

(async () => {
  const { plat, disconnect } = clientsFor(ENV, 'org_wct');
  try {
    const org = await plat.organization.findUnique({ where: { id: ORG }, select: { name: true } });
    if (!org) throw new Error('org not found');
    const ui: any = await plat.organizationUIConfig.findFirst({ where: { organizationId: ORG } });
    const features = { ...((ui?.features as any) ?? {}) };
    console.log(`${ENV} · ${org.name} · ${FLAG}: ${String(features[FLAG])} → ${String(value)}${APPLY ? '  *** APPLY ***' : '  (dry run)'}`);
    if (!APPLY) return;
    features[FLAG] = value;
    if (ui) await plat.organizationUIConfig.update({ where: { id: ui.id }, data: { features } });
    else await plat.organizationUIConfig.create({ data: { organizationId: ORG, features } as any });
    console.log('saved');
  } finally {
    await disconnect();
  }
})();
