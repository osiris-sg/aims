#!/usr/bin/env node
/* Build-time schema push (called by `npm run build` after `nest build`).
 *
 *   TENANCY_MODE unset      → `prisma db push` of prisma/schema.prisma, exactly as before.
 *   TENANCY_MODE=per-org    → generate + push prisma/tenancy/platform.prisma into schema "platform",
 *                             then every prisma/tenancy/orgs/<org>.prisma into its own schema org_<org>.
 *
 * Never passes --accept-data-loss: a destructive change aborts the build, same as today.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const run = (args, env = process.env) => {
  const r = spawnSync('npx', ['prisma', ...args], { stdio: 'inherit', env });
  if (r.status !== 0) process.exit(r.status || 1);
};

if (process.env.TENANCY_MODE !== 'per-org') {
  run(['db', 'push']);
  process.exit(0);
}

const withSchema = (schema) => {
  const u = new URL(process.env.DATABASE_URL);
  u.searchParams.set('schema', schema);
  return { ...process.env, DATABASE_URL: u.toString() };
};

const root = path.join(__dirname, '..', 'prisma', 'tenancy');
const orgFiles = fs.readdirSync(path.join(root, 'orgs')).filter((f) => f.endsWith('.prisma')).sort();

run(['generate']); // the original client: types + archive-only legacy tables
run(['generate', '--schema', path.join(root, 'platform.prisma')]);
for (const f of orgFiles) run(['generate', '--schema', path.join(root, 'orgs', f)]);

console.log('\n▶ platform');
run(['db', 'push', '--skip-generate', '--schema', path.join(root, 'platform.prisma')], withSchema('platform'));
for (const f of orgFiles) {
  const schema = `org_${f.replace(/\.prisma$/, '')}`;
  console.log(`\n▶ ${schema}`);
  run(['db', 'push', '--skip-generate', '--schema', path.join(root, 'orgs', f)], withSchema(schema));
}
