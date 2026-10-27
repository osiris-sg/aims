/**
 * Materialise ROLE_PRESETS (src/roles/role-presets.ts) into an org's roles.
 * Idempotent: existing roles with a preset's name are updated in place (their
 * user assignments survive), missing ones are created, superadmin is never
 * touched. --retire-unused deletes hand-made roles that no user holds.
 *
 *   npx ts-node --transpile-only scripts/apply-role-presets.ts --env prod --org <orgId> --schema org_wct [--retire-unused] [--apply]
 */
import { randomUUID } from 'crypto';
import { clientsFor, loadEnv, type Env } from './lib/tenancy-clients';
import { ROLE_PRESETS, presetDescription, resolvePresetPermissions } from '../src/roles/role-presets';

const args = process.argv.slice(2);
const argVal = (k: string, d?: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const ENV = (argVal('--env', 'dev') || 'dev') as Env;
const ORG = argVal('--org');
const SCHEMA = argVal('--schema', 'org_wct') as string;
const APPLY = args.includes('--apply');
const RETIRE = args.includes('--retire-unused');
if (!ORG) throw new Error('--org is required');
loadEnv(ENV);

(async () => {
  const { plat, org, disconnect } = clientsFor(ENV, SCHEMA);
  try {
    const o = await plat.organization.findUnique({ where: { id: ORG }, select: { name: true } });
    if (!o) throw new Error('org not found');
    console.log(`${ENV} · ${o.name} · role presets${APPLY ? '  *** APPLY ***' : '  (dry run)'}`);
    const catalogue: any[] = await org.permission.findMany({ select: { id: true, name: true } });
    const idByName = new Map<string, string>(catalogue.map((p) => [p.name, p.id]));
    const names = catalogue.map((p) => p.name);
    const presetNames = new Set(ROLE_PRESETS.map((p) => p.name));

    for (const preset of ROLE_PRESETS) {
      const perms = resolvePresetPermissions(preset, names);
      const ids = perms.map((n) => idByName.get(n)!).filter(Boolean);
      const existing: any = await org.role.findFirst({
        where: { organizationId: ORG, name: preset.name },
        include: { permissions: { select: { name: true } }, userRoles: { select: { userId: true } } },
      });
      const before = existing ? existing.permissions.length : 0;
      console.log(
        `  ${existing ? 'update' : 'create'}  ${preset.name.padEnd(12)} "${preset.label}"  perms ${before} → ${ids.length}  modules [${preset.allowedModules.join(',') || 'all'}]${existing ? `  users ${existing.userRoles.length}` : ''}`,
      );
      if (!APPLY) continue;
      if (existing) {
        await org.role.update({
          where: { id: existing.id },
          data: { description: presetDescription(preset), allowedModules: preset.allowedModules, permissions: { set: ids.map((id) => ({ id })) } },
        });
      } else {
        await org.role.create({
          data: {
            id: randomUUID(),
            organizationId: ORG,
            name: preset.name,
            description: presetDescription(preset),
            allowedModules: preset.allowedModules,
            permissions: { connect: ids.map((id) => ({ id })) },
          },
        });
      }
    }

    const others: any[] = await org.role.findMany({
      where: { organizationId: ORG, name: { notIn: [...presetNames, 'superadmin'] } },
      include: { userRoles: { select: { userId: true } } },
    });
    for (const r of others) {
      const unused = r.userRoles.length === 0;
      console.log(`  ${RETIRE && unused ? 'retire ' : 'keep   '} ${r.name.padEnd(12)} hand-made, users ${r.userRoles.length}${!unused ? ' (in use — left alone)' : ''}`);
      if (APPLY && RETIRE && unused) await org.role.delete({ where: { id: r.id } });
    }
    console.log(APPLY ? 'DONE' : 'DRY RUN DONE — re-run with --apply');
  } finally {
    await disconnect();
  }
})();
