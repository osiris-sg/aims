/**
 * Append a module code to ONE role's allowedModules (a restrictive list — an
 * empty list means every enabled module). Idempotent.
 *
 *   npx ts-node --transpile-only scripts/add-role-module.ts --env prod --org <orgId> --schema org_wct --role Admin --module USER_MANAGEMENT [--apply]
 */
import { clientsFor, loadEnv, type Env } from './lib/tenancy-clients';

const args = process.argv.slice(2);
const argVal = (k: string, d?: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const ENV = (argVal('--env', 'dev') || 'dev') as Env;
const ORG = argVal('--org');
const SCHEMA = argVal('--schema', 'org_wct') as string;
const ROLE = argVal('--role');
const MODULE = argVal('--module');
const APPLY = args.includes('--apply');
if (!ORG || !ROLE || !MODULE) throw new Error('--org, --role and --module are required');
loadEnv(ENV);

(async () => {
  const { org, disconnect } = clientsFor(ENV, SCHEMA);
  try {
    const role: any = await org.role.findFirst({ where: { organizationId: ORG, name: ROLE } });
    if (!role) throw new Error(`role "${ROLE}" not found on ${ORG}`);
    const list: string[] = Array.isArray(role.allowedModules) ? role.allowedModules : [];
    const has = list.includes(MODULE);
    console.log(`${ENV} · ${ROLE} · allowedModules=[${list.join(',')}] → ${has ? 'already has' : 'add'} ${MODULE}${APPLY ? '  *** APPLY ***' : '  (dry run)'}`);
    if (!APPLY || has || list.length === 0) return; // an empty list is unrestricted already
    await org.role.update({ where: { id: role.id }, data: { allowedModules: [...list, MODULE] } });
    console.log('saved');
  } finally {
    await disconnect();
  }
})();
