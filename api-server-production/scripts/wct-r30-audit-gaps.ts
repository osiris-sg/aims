/**
 * WCT round 30 (Elroy 20 Nov 2026): two audit gaps in the 4 WCT group orgs.
 *  (a) Activity Log in the menu (Org Settings > Audit Log, page /portal/audit with the Activity Log
 *      tab) for Admin: switch the org's AUDIT module row ON. The menu shows it only to a role whose
 *      allowedModules is [] (every module) or lists AUDIT; no WCT role lists AUDIT, so it is Admin
 *      and superadmin (and field-tech, which the portal sends to the field app). No role's
 *      allowedModules changes. The page also needs audit:read (checked and listed).
 *  (b) superadmin gets the same Orders access as Admin: the orders:* permissions Admin holds that
 *      superadmin lacks; superadmin's modules are [] (every module) so ORDERS already shows.
 * Nothing else is touched; no other org is read or written.
 *
 * DRY RUN by default.
 *   npx ts-node --transpile-only scripts/wct-r30-audit-gaps.ts --env prod             dry run on prod
 *   npx ts-node --transpile-only scripts/wct-r30-audit-gaps.ts --env prod --apply     writes (after Elroy's go)
 * --apply: one transaction per org (module row + permission links), an ActionLog row per change
 * ("System creation"), and scripts/wct-r30-audit-gaps.<env>.log.json.
 * dev = DATABASE_URL (each org's tenancy schema), prod = PROD_DATABASE_URL (public). URLs never printed.
 */
import * as fs from 'fs';
import * as path from 'path';

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

const ORGS = [
  '5c700000-0000-4000-8000-5c7000000001', // WCT (S) Systems
  '5c700000-0000-4000-8000-5c7000000002', // WCT Racking
  '5c700000-0000-4000-8000-5c7000000003', // YMM Kitchen
  '5c700000-0000-4000-8000-5c7000000004', // BC Air
];
const SCRIPT = 'system:wct-r30-audit-gaps';
const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const ENV = arg('--env') || 'dev';
const APPLY = process.argv.includes('--apply');
const OUT = arg('--out');
if (!['prod', 'dev'].includes(ENV)) throw new Error('--env must be prod or dev');

(async () => {
  const url = ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error(`no database url for --env ${ENV}`);
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows as any[];
  const lines: string[] = [];
  const say = (s: string) => {
    lines.push(s);
    console.log(s);
  };
  const log: any[] = [];
  let total = 0;
  say(`${ENV}: WCT group audit gaps (Activity Log menu for Admin, superadmin Orders)${APPLY ? '  *** APPLY ***' : '  (dry run)'}`);
  try {
    for (const org of ORGS) {
      let S = '"public"';
      let P = '"public"';
      if (ENV === 'dev') {
        P = '"platform"';
        const [t] = await q(`select "schemaName" s from "platform"."OrgTenant" where "organizationId" = $1 and status = 'ACTIVE'`, [org]).catch(() => [] as any[]);
        S = t?.s ? `"${t.s}"` : '"public"';
      }
      const [o] = await q(`select name from ${P}."Organization" where id = $1`, [org]);
      if (!o) {
        say(`\n== ${org}: not found, skipped`);
        continue;
      }
      const [flags] = await q(`select features from ${P}."OrganizationUIConfig" where "organizationId" = $1`, [org]).catch(() => [] as any[]);
      const [audit] = await q(`select id, enabled, "displayName", config from ${S}."OrganizationModule" where "organizationId" = $1 and "moduleCode" = 'AUDIT'`, [org]);
      const roles = await q(
        `select r.id, r.name, r."allowedModules",
                (select count(*)::int from ${S}."UserRole" ur where ur."roleId" = r.id and ur."isActive") users,
                coalesce((select array_agg(p.name order by p.name) from ${S}."_PermissionToRole" pr join ${S}."Permission" p on p.id = pr."A" where pr."B" = r.id), '{}') perms
           from ${S}."Role" r where r."organizationId" = $1 order by r.name`,
        [org],
      );
      say(`\n== ${o.name}`);

      // (a) Activity Log menu
      const sees = roles.filter((r) => !(r.allowedModules ?? []).length || (r.allowedModules ?? []).includes('AUDIT'));
      const urlOnly = roles.filter((r) => r.perms.includes('audit:read') && !sees.includes(r));
      say(`  (a) AUDIT module row: ${audit ? `enabled ${audit.enabled}` : 'MISSING (not created by this script)'}${audit && !audit.enabled ? ' -> true' : ''}; enableActionLog ${((flags?.features as any) || {}).enableActionLog === true ? 'on' : 'OFF'}`);
      for (const r of sees) {
        const note = r.name === 'field-tech' ? ' (field app only: the portal sends them to /scan, never sees the menu)' : r.perms.includes('audit:read') ? '' : ' (NO audit:read: the menu shows, the log is refused)';
        say(`      menu shows to ${r.name} (${r.users} user(s), modules ${(r.allowedModules ?? []).length ? `[${r.allowedModules.join(',')}]` : 'all'})${note}`);
      }
      say(`      not in the menu: ${roles.filter((r) => !sees.includes(r)).map((r) => r.name).join(', ') || 'none'}`);
      if (urlOnly.length) say(`      can still open /portal/audit by URL (hold audit:read, as today): ${urlOnly.map((r) => r.name).join(', ')}`);
      const auditChange = audit && !audit.enabled ? 1 : 0;

      // (b) superadmin Orders = Admin's
      const admin = roles.find((r) => r.name === 'Admin');
      const sup = roles.find((r) => r.name === 'superadmin');
      let addOrders: string[] = [];
      let addOrdersModule = false;
      if (!admin || !sup) say(`  (b) ${!admin ? 'no Admin role' : 'no superadmin role'}: skipped`);
      else {
        addOrders = admin.perms.filter((p: string) => p.startsWith('orders:') && !sup.perms.includes(p));
        addOrdersModule = (sup.allowedModules ?? []).length > 0 && !(sup.allowedModules ?? []).includes('ORDERS') && (!(admin.allowedModules ?? []).length || admin.allowedModules.includes('ORDERS'));
        say(`  (b) superadmin (${sup.users} user(s)) orders permissions: has [${sup.perms.filter((p: string) => p.startsWith('orders:')).join(', ') || 'none'}], Admin has [${admin.perms.filter((p: string) => p.startsWith('orders:')).join(', ')}]`);
        say(addOrders.length ? `      + permissions: ${addOrders.join(', ')}` : '      no permission change');
        say(addOrdersModule ? '      + modules: ORDERS' : `      modules: ${(sup.allowedModules ?? []).length ? `[${sup.allowedModules.join(',')}]` : 'all (already shows Orders)'}, no change`);
      }
      const n = auditChange + addOrders.length + (addOrdersModule ? 1 : 0);
      total += n;
      if (!APPLY || !n) continue;
      await c.query('begin');
      try {
        const act = async (resource: string, resourceId: string, result: any) =>
          c.query(
            `insert into ${S === '"public"' ? '"public"' : P}."ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
             values (gen_random_uuid(), 'SYSTEM', $1, 'System creation', $2, 'operator', 'UPDATE', $3, $4, $5, 'SUCCESS')`,
            [SCRIPT, org, resource, resourceId, JSON.stringify({ result })],
          );
        if (auditChange) {
          await c.query(`update ${S}."OrganizationModule" set enabled = true, "updatedAt" = now() where id = $1 and enabled = false`, [audit.id]);
          await act('configuration', audit.id, { module: 'AUDIT', enabled: { from: false, to: true }, note: 'Org Settings > Audit Log (Activity Log) in the menu for Admin' });
          log.push({ org, orgName: o.name, change: 'AUDIT module enabled', moduleId: audit.id });
        }
        if (addOrders.length || addOrdersModule) {
          for (const name of addOrders) {
            const [p] = await q(`select id from ${S}."Permission" where name = $1`, [name]);
            await c.query(`insert into ${S}."_PermissionToRole"("A","B") values ($1,$2) on conflict do nothing`, [p.id, sup.id]);
          }
          if (addOrdersModule) await c.query(`update ${S}."Role" set "allowedModules" = $2, "updatedAt" = now() where id = $1`, [sup.id, [...sup.allowedModules, 'ORDERS']]);
          await act('role', sup.id, { role: 'superadmin', addedPermissions: addOrders, addedModules: addOrdersModule ? ['ORDERS'] : [] });
          log.push({ org, orgName: o.name, change: 'superadmin orders', roleId: sup.id, addedPermissions: addOrders, addedModules: addOrdersModule ? ['ORDERS'] : [] });
        }
        await c.query('commit');
      } catch (e) {
        await c.query('rollback');
        throw e;
      }
    }
    if (APPLY) {
      fs.writeFileSync(path.join(__dirname, `wct-r30-audit-gaps.${ENV}.log.json`), JSON.stringify({ at: new Date().toISOString(), env: ENV, changes: log }, null, 2));
      say(`\nAPPLIED: ${total} change(s); log scripts/wct-r30-audit-gaps.${ENV}.log.json`);
    } else {
      say(`\nDRY RUN: ${total} change(s), nothing written. Re-run with --apply after Elroy's go.`);
    }
  } finally {
    await c.end();
    if (OUT) fs.writeFileSync(OUT, lines.join('\n') + '\n');
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
