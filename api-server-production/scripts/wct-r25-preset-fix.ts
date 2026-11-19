/**
 * WCT round 25 (Elroy 19 Nov 2026): fix the preset roles of the 4 WCT group orgs.
 *   Sales      = Orders edit, Jobs edit, Service Reports view, Calendar
 *   Accounting = Orders view, Accounting edit
 *   Operations = Orders view, Jobs + Service Reports + Calendar edit (round 30: jobs / DO update via
 *                deliveries:update, NOT documents:update; CALENDAR = the Jobs > Calendar tab)
 *   Viewer     = view all (no edit anywhere)
 * Each role keeps its other access (PRESET_FIXES in src/roles/role-presets.ts lists what is
 * added; only the Viewer loses anything, and only a non-read permission). Modules an org has
 * switched off are not added; a role with every module ([]) is left as is. Admin, superadmin,
 * field-tech and hand-made roles are not touched. No other org is read or written.
 *
 * DRY RUN by default (prints every permission / module added or removed per role per org).
 *   npx ts-node --transpile-only scripts/wct-r25-preset-fix.ts --env prod            dry run on prod
 *   npx ts-node --transpile-only scripts/wct-r25-preset-fix.ts --env prod --apply    writes (after Elroy's go)
 * New permission rows (NEW_PERMISSIONS: deliveries:update) are created in the catalogue when missing
 * (they grant nothing by themselves; only the roles below get them).
 * --apply: one transaction per org (role permission links + allowedModules), an ActionLog row
 * per changed role ("System creation", resource role), and scripts/wct-r25-preset-fix.<env>.log.json.
 * dev = DATABASE_URL (each org's tenancy schema), prod = PROD_DATABASE_URL (public). URLs never printed.
 */
import * as fs from 'fs';
import * as path from 'path';
import { NEW_PERMISSIONS, PRESET_FIXES, PRESET_PREFIX, PSEUDO_MODULES, planPresetFix } from '../src/roles/role-presets';

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

const ORGS = [
  '5c700000-0000-4000-8000-5c7000000001', // WCT (S) Systems
  '5c700000-0000-4000-8000-5c7000000002', // WCT Racking
  '5c700000-0000-4000-8000-5c7000000003', // YMM Kitchen
  '5c700000-0000-4000-8000-5c7000000004', // BC Air
];
const SCRIPT = 'system:wct-r25-preset-fix';
const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const ENV = arg('--env') || 'dev';
const APPLY = process.argv.includes('--apply');
if (!['prod', 'dev'].includes(ENV)) throw new Error('--env must be prod or dev');

(async () => {
  const url = ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error(`no database url for --env ${ENV}`);
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows as any[];
  const log: any[] = [];
  const announced = new Set<string>();
  let total = 0;
  console.log(`${ENV}: WCT group preset fix${APPLY ? '  *** APPLY ***' : '  (dry run)'}`);
  try {
    for (const org of ORGS) {
      // Prod: one public schema. Dev: the org's tenancy schema (platform.OrgTenant), else public.
      let S = '"public"';
      let P = '"public"';
      if (ENV === 'dev') {
        P = '"platform"';
        const [t] = await q(`select "schemaName" s from "platform"."OrgTenant" where "organizationId" = $1 and status = 'ACTIVE'`, [org]).catch(() => [] as any[]);
        S = t?.s ? `"${t.s}"` : '"public"';
      }
      const [o] = await q(`select name from ${P}."Organization" where id = $1`, [org]);
      if (!o) {
        console.log(`\n== ${org}: not found, skipped`);
        continue;
      }
      const modsOn = (await q(`select "moduleCode" m from ${S}."OrganizationModule" where "organizationId" = $1 and enabled`, [org]).catch(() => [] as any[])).map((r) => r.m);
      const catalogue = (await q(`select id, name from ${S}."Permission" order by name`)).map((r) => ({ id: r.id, name: r.name }));
      // Round 30: permissions the fix needs that this catalogue lacks are created (on --apply) before the links.
      const missing = NEW_PERMISSIONS.filter((p) => !catalogue.some((x) => x.name === p.name));
      for (const p of missing) {
        if (!announced.has(`${S}|${p.name}`)) console.log(`  + new permission in the catalogue${S === '"public"' ? ' (prod: one global row)' : ` (${S})`}: ${p.name}`);
        announced.add(`${S}|${p.name}`);
        catalogue.push({ id: `new:${p.name}`, name: p.name });
      }
      const idOf = new Map(catalogue.map((p) => [p.name, p.id]));
      const roles = await q(
        `select r.id, r.name, r.description, r."allowedModules",
                (select count(*)::int from ${S}."UserRole" ur where ur."roleId" = r.id and ur."isActive") users,
                coalesce((select array_agg(p.name order by p.name) from ${S}."_PermissionToRole" pr join ${S}."Permission" p on p.id = pr."A" where pr."B" = r.id), '{}') perms
           from ${S}."Role" r where r."organizationId" = $1 order by r.name`,
        [org],
      );
      console.log(`\n== ${o.name} (modules on: ${modsOn.join(', ') || 'none'})`);
      const changes: any[] = [];
      for (const r of roles) {
        const fix = PRESET_FIXES[r.name];
        const isPreset = String(r.description ?? '').startsWith(PRESET_PREFIX);
        if (!fix || !isPreset) {
          console.log(`  ${r.name.padEnd(11)} not changed${!fix ? '' : ' (not a preset row)'}`);
          continue;
        }
        const plan = planPresetFix(fix, { permissions: r.perms, allowedModules: r.allowedModules ?? [] }, catalogue.map((p) => p.name), modsOn);
        const n = plan.addPerms.length + plan.removePerms.length + plan.addModules.length;
        total += n;
        console.log(`  ${r.name.padEnd(11)} ${r.users} user(s), ${r.perms.length} permissions, modules [${(r.allowedModules ?? []).join(',') || 'all'}]${n ? '' : '  no change'}`);
        if (plan.addPerms.length) console.log(`      + permissions: ${plan.addPerms.join(', ')}`);
        if (plan.removePerms.length) console.log(`      - permissions: ${plan.removePerms.join(', ')}`);
        if (plan.addModules.length) console.log(`      + modules:     ${plan.addModules.join(', ')}`);
        const skipped = fix.modules.filter((m) => !modsOn.includes(m) && !PSEUDO_MODULES.has(m) && !(r.allowedModules ?? []).includes(m) && (r.allowedModules ?? []).length);
        if (skipped.length) console.log(`      (module off in this org, not added: ${skipped.join(', ')})`);
        if (n) changes.push({ role: r, plan });
      }
      if (!APPLY || !changes.length) continue;
      await c.query('begin');
      try {
        for (const p of missing) {
          const [row] = await q(
            `insert into ${S}."Permission"(id, name, description, resource, action, "createdAt", "updatedAt") values (gen_random_uuid()::text, $1, $2, $3, $4, now(), now())
             on conflict (name) do update set name = excluded.name returning id`,
            [p.name, p.description, p.resource, p.action],
          );
          idOf.set(p.name, row.id);
        }
        for (const { role, plan } of changes) {
          for (const name of plan.addPerms) await c.query(`insert into ${S}."_PermissionToRole"("A","B") values ($1,$2) on conflict do nothing`, [idOf.get(name), role.id]);
          for (const name of plan.removePerms) await c.query(`delete from ${S}."_PermissionToRole" where "A" = $1 and "B" = $2`, [idOf.get(name), role.id]);
          if (plan.addModules.length) await c.query(`update ${S}."Role" set "allowedModules" = $2, "updatedAt" = now() where id = $1`, [role.id, [...(role.allowedModules ?? []), ...plan.addModules]]);
          await c.query(
            `insert into ${S === '"public"' ? '"public"' : P}."ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
             values (gen_random_uuid(), 'SYSTEM', $1, 'System creation', $2, 'operator', 'UPDATE', 'role', $3, $4, 'SUCCESS')`,
            [SCRIPT, org, role.id, JSON.stringify({ result: { role: role.name, addedPermissions: plan.addPerms, removedPermissions: plan.removePerms, addedModules: plan.addModules } })],
          );
          log.push({ org, orgName: o.name, roleId: role.id, role: role.name, ...plan });
        }
        await c.query('commit');
      } catch (e) {
        await c.query('rollback');
        throw e;
      }
    }
    if (APPLY) {
      fs.writeFileSync(path.join(__dirname, `wct-r25-preset-fix.${ENV}.log.json`), JSON.stringify({ at: new Date().toISOString(), env: ENV, changes: log }, null, 2));
      console.log(`\nAPPLIED: ${total} change(s); log scripts/wct-r25-preset-fix.${ENV}.log.json`);
    } else {
      console.log(`\nDRY RUN: ${total} change(s), nothing written. Re-run with --apply after Elroy's go.`);
    }
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
