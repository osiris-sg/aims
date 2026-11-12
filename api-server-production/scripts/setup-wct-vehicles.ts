/**
 * WCT Vehicles (2026-11-12): switch enableWctVehicles ON for WCT (S) Systems
 * ONLY and grant the three permissions to its roles. Idempotent; dry run by
 * default (prints what it would change).
 *
 *   vehicles:read     Admin, Operations, superadmin, Accounting, Sales, Viewer (office roles; not field-tech)
 *   vehicles:update   Admin, Operations, superadmin   (register, start / end usage, log damage)
 *   vehicles:approve  Admin, superadmin               (approve a repair, unlock an approved one)
 *
 * Dev (per-org tenancy: roles in org_wct, the flag in platform):
 *   npx ts-node --transpile-only scripts/setup-wct-vehicles.ts --target=tenancy [--apply]
 * Prod (everything in public; prod URL passed inline as DBURL):
 *   DBURL=<prod> npx ts-node --transpile-only scripts/setup-wct-vehicles.ts --target=public [--apply --confirm-prod]
 *
 * Touches no other org: every write is scoped to WCT_ORG_ID.
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Client } from 'pg';

const WCT_ORG_ID = '5c700000-0000-4000-8000-5c7000000001';
const FLAG = 'enableWctVehicles';

const GRANTS: Record<string, { description: string; action: string; roles: string[] }> = {
  'vehicles:read': { description: 'View vehicles and their usage log', action: 'read', roles: ['Admin', 'Operations', 'superadmin', 'Accounting', 'Sales', 'Viewer'] },
  'vehicles:update': { description: 'Keep the vehicle register and usage log', action: 'update', roles: ['Admin', 'Operations', 'superadmin'] },
  'vehicles:approve': { description: 'Approve vehicle repairs and unlock approved ones', action: 'approve', roles: ['Admin', 'superadmin'] },
};

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const apply = process.argv.includes('--apply');
const target = arg('target');

(async () => {
  if (target !== 'tenancy' && target !== 'public') throw new Error('Pass --target=tenancy (dev) or --target=public (prod)');
  const url = target === 'public' ? process.env.DBURL || '' : process.env.DATABASE_URL || '';
  if (!url) throw new Error(target === 'public' ? 'Pass the prod URL inline as DBURL' : 'DATABASE_URL is not set');
  const prodHost = process.env.PROD_DATABASE_URL ? new URL(process.env.PROD_DATABASE_URL).host : '';
  const isProd = !!prodHost && new URL(url).host === prodHost;
  if (target === 'tenancy' && isProd) throw new Error('Refusing: --target=tenancy is for the dev database');
  if (apply && isProd && !process.argv.includes('--confirm-prod')) throw new Error('Applying to prod needs --confirm-prod');
  const rolesSchema = target === 'tenancy' ? 'org_wct' : 'public';
  const configSchema = target === 'tenancy' ? 'platform' : 'public';

  const c = new Client({ connectionString: url });
  await c.connect();
  const plan: string[] = [];
  try {
    if (apply) await c.query('BEGIN');
    const org = await c.query(`SELECT id, name FROM "${configSchema}"."Organization" WHERE id = $1`, [WCT_ORG_ID]);
    if (!org.rows.length) throw new Error(`WCT org ${WCT_ORG_ID} not found in ${configSchema}`);
    console.log(`Org: ${org.rows[0].name} (${WCT_ORG_ID})${isProd ? '  [PROD]' : ''}`);

    // 1) the flag, WCT only
    const cfg = await c.query(`SELECT id, features FROM "${configSchema}"."OrganizationUIConfig" WHERE "organizationId" = $1`, [WCT_ORG_ID]);
    if (!cfg.rows.length) throw new Error('WCT has no OrganizationUIConfig row');
    if (cfg.rows[0].features?.[FLAG] === true) plan.push(`flag ${FLAG}: already on`);
    else {
      plan.push(`flag ${FLAG}: ${cfg.rows[0].features?.[FLAG] ?? 'unset'} -> true`);
      if (apply) {
        await c.query(
          `UPDATE "${configSchema}"."OrganizationUIConfig" SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object($2::text, true), "updatedAt" = now() WHERE "organizationId" = $1`,
          [WCT_ORG_ID, FLAG],
        );
      }
    }

    // 2) permissions + grants, WCT roles only
    const roles = await c.query(`SELECT id, name FROM "${rolesSchema}"."Role" WHERE "organizationId" = $1`, [WCT_ORG_ID]);
    for (const [name, g] of Object.entries(GRANTS)) {
      let perm = (await c.query(`SELECT id FROM "${rolesSchema}"."Permission" WHERE name = $1`, [name])).rows[0];
      if (!perm) {
        plan.push(`permission ${name}: create`);
        if (apply) {
          perm = (
            await c.query(
              `INSERT INTO "${rolesSchema}"."Permission" (id, name, description, resource, action, "createdAt", "updatedAt") VALUES ($1, $2, $3, 'vehicles', $4, now(), now()) RETURNING id`,
              [randomUUID(), name, g.description, g.action],
            )
          ).rows[0];
        }
      }
      for (const roleName of g.roles) {
        const role = roles.rows.find((r) => r.name === roleName);
        if (!role) {
          plan.push(`  ${name} -> ${roleName}: role not found, skipped`);
          continue;
        }
        const has = perm ? (await c.query(`SELECT 1 FROM "${rolesSchema}"."_PermissionToRole" WHERE "A" = $1 AND "B" = $2`, [perm.id, role.id])).rows.length : 0;
        if (has) continue;
        plan.push(`  ${name} -> ${roleName}: grant`);
        if (apply) await c.query(`INSERT INTO "${rolesSchema}"."_PermissionToRole" ("A", "B") VALUES ($1, $2) ON CONFLICT DO NOTHING`, [perm.id, role.id]);
      }
    }
    if (apply) await c.query('COMMIT');
  } catch (e) {
    if (apply) await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
  console.log(plan.length ? plan.join('\n') : 'Nothing to change');
  console.log(apply ? '\nApplied.' : '\nDry run. Pass --apply to change it.');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
