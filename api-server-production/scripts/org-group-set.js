// Org groups (WCT 2026-11-17): set Organization.parentOrgId on child orgs (data, never hard-coded in the app),
// and optionally turn the parent's group calendar setting on (features.enableGroupCalendar).
//
// DRY RUN by default. --apply writes, in one transaction, one ActionLog row (actor system:org-group-set) per
// changed org, plus a local log file scripts/org-group-set.log.json. Fills empty fields only: a child that already
// has a different parent is refused, never overwritten. One level only: a parent may not itself be a child, and a
// child may not be a parent.
//
//   node scripts/org-group-set.js --env prod --parent <parentOrgId> --children <id>,<id>,<id> [--calendar-on] [--apply]
//   --env dev (default) uses DATABASE_URL, --env prod uses PROD_DATABASE_URL (never printed).
require('dotenv').config({ path: __dirname + '/../.env' });
const { Client, types } = require('pg');
const fs = require('fs');

types.setTypeParser(1114, (s) => s);
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const APPLY = process.argv.includes('--apply');
const CAL = process.argv.includes('--calendar-on');
const ENV = arg('--env') || 'dev';
const PARENT = arg('--parent');
const CHILDREN = String(arg('--children') || '').split(',').map((s) => s.trim()).filter(Boolean);
const FLAG = 'enableGroupCalendar';
const ACTOR = 'system:org-group-set';

(async () => {
  if (!['dev', 'prod'].includes(ENV)) throw new Error('--env must be dev or prod');
  if (!PARENT || !CHILDREN.length) throw new Error('usage: --parent <orgId> --children <id>,<id> [--calendar-on] [--env prod] [--apply]');
  if (CHILDREN.includes(PARENT)) throw new Error('the parent cannot be its own child');
  if (new Set(CHILDREN).size !== CHILDREN.length) throw new Error('a child is listed twice');
  const url = ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error(`no database url for ${ENV}`);
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (s, p) => (await c.query(s, p)).rows;

  // Prod = public layout; dev = per-org tenancy (Organization, UI config and ActionLog in "platform").
  const schema = (await q(`select table_schema from information_schema.tables where table_name='Organization' and table_schema in ('platform','public') order by table_schema='platform' desc`))[0]?.table_schema;
  if (!schema) throw new Error('no Organization table');
  const T = (t) => `"${schema}"."${t}"`;
  const hasCol = (await q(`select 1 from information_schema.columns where table_schema=$1 and table_name='Organization' and column_name='parentOrgId'`, [schema])).length > 0;
  console.log(`${ENV}: Organization in schema ${schema}; parentOrgId column ${hasCol ? 'present' : 'MISSING'}`);
  if (!hasCol) {
    console.log(ENV === 'prod' ? 'Deploy first: Render adds the column on build. Nothing to do yet.' : 'Run scripts/_org-group-dev-column.js --apply first.');
    await c.end();
    return;
  }

  const ids = [PARENT, ...CHILDREN];
  const orgs = await q(`select id, name, "parentOrgId" from ${T('Organization')} where id::text = any($1::text[])`, [ids]);
  const byId = new Map(orgs.map((o) => [o.id, o]));
  for (const id of ids) if (!byId.has(id)) throw new Error(`org ${id} not found`);
  const parent = byId.get(PARENT);
  if (parent.parentOrgId) throw new Error(`${parent.name} is itself a child (one level only)`);
  const kids = await q(`select id, name from ${T('Organization')} where "parentOrgId" = any($1::text[])`, [CHILDREN]);
  if (kids.length) throw new Error(`a listed child already has children: ${kids.map((k) => k.name).join(', ')}`);

  const changes = [];
  console.log(`parent: ${parent.name}`);
  for (const id of CHILDREN) {
    const o = byId.get(id);
    if (o.parentOrgId === PARENT) console.log(`  child ${o.name}: already set, no change`);
    else if (o.parentOrgId) throw new Error(`${o.name} already has another parent (${o.parentOrgId}); refusing to overwrite`);
    else {
      console.log(`  child ${o.name}: parentOrgId null -> ${parent.name}`);
      changes.push({ kind: 'parent', orgId: id, name: o.name, before: null, after: PARENT });
    }
  }
  if (CAL) {
    const ui = (await q(`select id, features from ${T('OrganizationUIConfig')} where "organizationId"=$1`, [PARENT]))[0];
    if (!ui) throw new Error(`${parent.name} has no OrganizationUIConfig row`);
    const before = (ui.features || {})[FLAG];
    if (before === true) console.log(`  ${parent.name} ${FLAG}: already on`);
    else {
      console.log(`  ${parent.name} ${FLAG}: ${JSON.stringify(before)} -> true`);
      changes.push({ kind: 'flag', orgId: PARENT, name: parent.name, uiId: ui.id, before: before ?? null, after: true });
    }
  }
  const others = await q(`select o.name from ${T('Organization')} o where o."parentOrgId" is not null and not (o.id::text = any($1::text[]))`, [CHILDREN]);
  console.log(`other orgs with a parent: ${others.length ? others.map((r) => r.name).join(', ') : 'none'}`);

  if (!changes.length) {
    console.log('nothing to do');
    await c.end();
    return;
  }
  if (!APPLY) {
    console.log(`DRY RUN: ${changes.length} change(s), no write. Re-run with --apply.`);
    await c.end();
    return;
  }
  await c.query('begin');
  try {
    for (const ch of changes) {
      if (ch.kind === 'parent') {
        const r = await c.query(`update ${T('Organization')} set "parentOrgId"=$2 where id=$1 and "parentOrgId" is null`, [ch.orgId, PARENT]);
        if (r.rowCount !== 1) throw new Error(`${ch.name} changed under us; nothing written`);
      } else {
        await c.query(`update ${T('OrganizationUIConfig')} set features = coalesce(features,'{}'::jsonb) || jsonb_build_object($2::text, true) where id=$1`, [ch.uiId, FLAG]);
      }
      await c.query(
        `insert into ${T('ActionLog')} (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
         values (gen_random_uuid(), 'SYSTEM', $1, 'System creation', $2, 'operator', 'UPDATE', $3, $2, $4, 'SUCCESS')`,
        [ACTOR, ch.orgId, ch.kind === 'parent' ? 'organization' : 'organization-features', JSON.stringify({ note: ch.kind === 'parent' ? `parentOrgId: null -> ${PARENT} (${parent.name})` : `${FLAG}: ${JSON.stringify(ch.before)} -> true` })],
      );
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
  fs.writeFileSync(__dirname + '/org-group-set.log.json', JSON.stringify({ at: new Date().toISOString(), env: ENV, parent: PARENT, changes }, null, 2));
  console.log(`APPLIED: ${changes.length} change(s); log scripts/org-group-set.log.json`);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
