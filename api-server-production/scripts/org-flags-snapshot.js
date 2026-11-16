/**
 * READ-ONLY: every org's feature flags / settings (OrganizationUIConfig.features)
 * plus module toggles and the letterhead fields, to a JSON file; with --compare <old.json> it also
 * lists every org whose values changed. Used around a flag change to prove only
 * the intended org moved.
 *
 *   node scripts/org-flags-snapshot.js --env prod --out /path/before.json
 *   node scripts/org-flags-snapshot.js --env prod --out /path/after.json --compare /path/before.json
 */
require('dotenv').config({ path: __dirname + '/../.env' });
const { Client } = require('pg');
const fs = require('fs');

const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};
const env = arg('--env') || 'dev';
const out = arg('--out');
const compare = arg('--compare');

(async () => {
  const url = env === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url || !out) throw new Error('need --env dev|prod and --out <file>');
  const c = new Client({ connectionString: url });
  await c.connect();
  const S = env === 'prod' ? '"public"' : '"platform"';
  const rows = (
    await c.query(
      `select o.id, o.name, o.email, o.logo is not null as "hasLogo", o."phoneNumber", u.features
         from ${S}."Organization" o left join ${S}."OrganizationUIConfig" u on u."organizationId" = o.id order by o.name`,
    )
  ).rows;
  const mods = (await c.query(`select "organizationId" o, "moduleCode" m, enabled from ${S}."OrganizationModule"`)).rows;
  const modsOf = (id) => Object.fromEntries(mods.filter((x) => x.o === id).sort((a, b) => a.m.localeCompare(b.m)).map((x) => [x.m, x.enabled]));
  const snap = Object.fromEntries(rows.map((r) => [r.id, { name: r.name, email: r.email, hasLogo: r.hasLogo, phoneNumber: r.phoneNumber, features: r.features || {}, modules: modsOf(r.id) }]));
  fs.writeFileSync(out, JSON.stringify(snap, null, 1));
  console.log(`${env}: ${rows.length} orgs written to ${out}`);
  if (compare) {
    const old = JSON.parse(fs.readFileSync(compare, 'utf8'));
    const changed = [];
    for (const id of new Set([...Object.keys(old), ...Object.keys(snap)])) {
      const a = old[id] || {};
      const b = snap[id] || {};
      const diffs = [];
      for (const k of ['name', 'email', 'hasLogo', 'phoneNumber']) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push(`${k}: ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`);
      const fk = new Set([...Object.keys(a.features || {}), ...Object.keys(b.features || {})]);
      for (const k of fk) if (JSON.stringify((a.features || {})[k]) !== JSON.stringify((b.features || {})[k])) diffs.push(`features.${k}: ${JSON.stringify((a.features || {})[k])} -> ${JSON.stringify((b.features || {})[k])}`);
      if (a.modules) for (const k of new Set([...Object.keys(a.modules), ...Object.keys(b.modules || {})])) if ((a.modules || {})[k] !== (b.modules || {})[k]) diffs.push(`modules.${k}: ${(a.modules || {})[k]} -> ${(b.modules || {})[k]}`);
      if (diffs.length) changed.push({ id, name: b.name || a.name, diffs });
    }
    console.log(changed.length ? `CHANGED ORGS (${changed.length}):` : 'NO ORG CHANGED');
    for (const ch of changed) console.log(`  ${ch.name} (${ch.id})\n    ${ch.diffs.join('\n    ')}`);
  }
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
