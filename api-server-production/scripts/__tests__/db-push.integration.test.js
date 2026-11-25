// Integration test of scripts/db-push.js against a THROWAAWAY Postgres. Skipped unless
// PUSHGUARD_TEST_DATABASE_URL is set, e.g.
//   createdb -h localhost -p 5433 aims_pushguard_test
//   PUSHGUARD_TEST_DATABASE_URL=postgresql://$USER@localhost:5433/aims_pushguard_test npm run test:pushguard
// It copies db-push.js + lib into a temp project with small fixture schemas (NO generator
// blocks, so nothing is written into the shared node_modules) and runs it as the build would.
// It drops and recreates the pg schemas pushguard_legacy / platform / org_a / org_b in that database.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BASE = process.env.PUSHGUARD_TEST_DATABASE_URL;
const SRC = path.join(__dirname, '..');
const NODE_MODULES = fs.realpathSync(path.join(SRC, '..', 'node_modules'));
const skip = !BASE && 'PUSHGUARD_TEST_DATABASE_URL not set';

const DS = 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n';
const ORG_V1 = `${DS}
model Org {
  id    String  @id
  name  String  @unique
  qty   Int?
  note  String?
  @@index([qty])
}
`;
const ORG_V2 = ORG_V1.replace('  note  String?\n', '  note  String?\n  extra String?\n  flag  Boolean @default(false)\n') + `
model Tag {
  id   String @id
  name String
  @@index([name])
}
`;
const ORG_V3_DROPS = ORG_V2.replace('  note  String?\n', '').replace('  @@index([qty])\n', '');

function sql(url, q) {
  const { Client } = require(path.join(NODE_MODULES, 'pg'));
  return (async () => {
    const u = new URL(url); u.searchParams.delete('schema');
    const c = new Client({ connectionString: u.toString() });
    await c.connect();
    try { return (await c.query(q)).rows; } finally { await c.end(); }
  })();
}
const withSchema = (s) => { const u = new URL(BASE); u.searchParams.set('schema', s); return u.toString(); };
const columns = async (schema, table) => (await sql(BASE, `select column_name from information_schema.columns where table_schema='${schema}' and table_name='${table}' order by 1`)).map((r) => r.column_name);
const indexes = async (schema, table) => (await sql(BASE, `select indexname from pg_indexes where schemaname='${schema}' and tablename='${table}' order by 1`)).map((r) => r.indexname);

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pushguard-'));
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(SRC, 'db-push.js'), path.join(dir, 'scripts', 'db-push.js'));
  for (const f of fs.readdirSync(path.join(SRC, 'lib'))) fs.copyFileSync(path.join(SRC, 'lib', f), path.join(dir, 'scripts', 'lib', f));
  fs.mkdirSync(path.join(dir, 'prisma', 'tenancy', 'orgs'), { recursive: true });
  fs.copyFileSync(path.join(SRC, '..', 'prisma', 'allow-destructive.txt'), path.join(dir, 'prisma', 'allow-destructive.txt'));
  fs.symlinkSync(NODE_MODULES, path.join(dir, 'node_modules'));
  const write = (rel, text) => fs.writeFileSync(path.join(dir, rel), text);
  const push = (env) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(DATABASE_URL|PROD_DATABASE_URL|TENANCY_MODE|NEON_)/.test(k)));
    const r = spawnSync('node', ['scripts/db-push.js'], { cwd: dir, env: { ...clean, ...env }, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };
  return { dir, write, push, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('legacy mode: additive pushes, destructive blocks (DB untouched), allowlist lets it through', { skip, timeout: 120000 }, async () => {
  await sql(BASE, 'drop schema if exists pushguard_legacy cascade; create schema pushguard_legacy');
  const p = project();
  const env = { DATABASE_URL: withSchema('pushguard_legacy') };
  try {
    p.write('prisma/schema.prisma', ORG_V1);
    let r = p.push(env);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Schema changes this deploy will apply:[\s\S]*CREATE TABLE "Org"/);
    assert.match(r.out, /NEON_API_KEY not set/);

    // (a) additive: nullable column, defaulted column, new table, new index
    p.write('prisma/schema.prisma', ORG_V2);
    r = p.push(env);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(await columns('pushguard_legacy', 'Org'), ['extra', 'flag', 'id', 'name', 'note', 'qty']);
    assert.ok((await indexes('pushguard_legacy', 'Tag')).includes('Tag_name_idx'));

    r = p.push(env);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /no schema changes/);

    // (b) destructive: drop the (empty!) column + a declared index, plus a hand-made index the
    //     schema never declared — plain db push would silently drop all three.
    await sql(BASE, 'create index "manual_org_name_qty" on pushguard_legacy."Org" (name, qty)');
    p.write('prisma/schema.prisma', ORG_V3_DROPS);
    r = p.push(env);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /DROP_COLUMN Org\.note/);
    assert.match(r.out, /DROP_INDEX Org_qty_idx/);
    assert.match(r.out, /DROP_INDEX manual_org_name_qty/);
    assert.match(r.out, /Nothing was pushed/);
    assert.ok((await columns('pushguard_legacy', 'Org')).includes('note'), 'column must survive');
    const idx = await indexes('pushguard_legacy', 'Org');
    assert.ok(idx.includes('Org_qty_idx') && idx.includes('manual_org_name_qty'), idx.join());

    // allowlist two of three → still blocked; all three → pushes and reports the allowances
    p.write('prisma/allow-destructive.txt', '# test\nDROP_COLUMN Org.note\nDROP_INDEX Org_qty_idx\n');
    r = p.push(env);
    assert.equal(r.code, 1, r.out);
    assert.ok((await columns('pushguard_legacy', 'Org')).includes('note'));
    p.write('prisma/allow-destructive.txt', 'DROP_COLUMN Org.note\nDROP_INDEX Org_qty_idx\nDROP_INDEX manual_org_name_qty\nDROP_TABLE Unused\n');
    r = p.push(env);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /allowed by prisma\/allow-destructive\.txt line 1: DROP_COLUMN Org\.note/);
    assert.match(r.out, /not used by this push.*DROP_TABLE Unused/);
    assert.ok(!(await columns('pushguard_legacy', 'Org')).includes('note'));
  } finally {
    p.cleanup();
    await sql(BASE, 'drop schema if exists pushguard_legacy cascade');
  }
});

test('allowlisted type change on a column WITH data (Decimal(14,3) → (14,4)) pushes with --accept-data-loss; unlisted blocks', { skip, timeout: 120000 }, async () => {
  // Round BZ (25 Nov 2026): Prisma refused the allowlisted Shipment weight widening on Render ("Use the --accept-data-loss flag").
  await sql(BASE, 'drop schema if exists pushguard_legacy cascade; create schema pushguard_legacy');
  const p = project();
  const env = { DATABASE_URL: withSchema('pushguard_legacy') };
  const V1 = `${DS}\nmodel Ship {\n  id  String   @id\n  net Decimal? @db.Decimal(14, 3)\n}\n`;
  try {
    p.write('prisma/allow-destructive.txt', '# none\n');
    p.write('prisma/schema.prisma', V1);
    let r = p.push(env);
    assert.equal(r.code, 0, r.out);
    await sql(BASE, `insert into pushguard_legacy."Ship" (id, net) values ('a', 50.04), ('b', 50.062)`);
    p.write('prisma/schema.prisma', V1.replace('Decimal(14, 3)', 'Decimal(14, 4)'));
    r = p.push(env);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /ALTER_COLUMN_TYPE Ship\.net/);
    p.write('prisma/allow-destructive.txt', 'ALTER_COLUMN_TYPE Ship.net\n');
    r = p.push(env);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /pushing with --accept-data-loss/);
    const rows = await sql(BASE, `select id, net::text as net from pushguard_legacy."Ship" order by id`);
    assert.deepEqual(rows.map((x) => x.net), ['50.0400', '50.0620']);
    await sql(BASE, `update pushguard_legacy."Ship" set net = 50.0395 where id = 'a'`);
    assert.equal((await sql(BASE, `select net::text as net from pushguard_legacy."Ship" where id = 'a'`))[0].net, '50.0395');
  } finally {
    p.cleanup();
    await sql(BASE, 'drop schema if exists pushguard_legacy cascade');
  }
});

test('diff error (unreachable DB): fails, pushes nothing, leaks no URL or password', { skip, timeout: 60000 }, async () => {
  const p = project();
  try {
    p.write('prisma/schema.prisma', ORG_V1);
    const r = p.push({ DATABASE_URL: 'postgresql://nobody:pw-very-secret@127.0.0.1:5999/nowhere?schema=x' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /prisma migrate diff failed/);
    assert.match(r.out, /NOT pushing/);
    assert.ok(!/pw-very-secret|postgresql:\/\/|127\.0\.0\.1/.test(r.out), r.out);
    assert.ok(!/db push|Your database is now in sync/i.test(r.out));
  } finally {
    p.cleanup();
  }
});

test('per-org mode: every schema checked first; one blocked schema stops ALL pushes', { skip, timeout: 120000 }, async () => {
  await sql(BASE, 'drop schema if exists platform cascade; drop schema if exists org_a cascade; drop schema if exists org_b cascade');
  const p = project();
  const env = { DATABASE_URL: BASE, TENANCY_MODE: 'per-org' };
  try {
    p.write('prisma/schema.prisma', ORG_V1);
    p.write('prisma/tenancy/platform.prisma', `${DS}\nmodel Organization {\n  id String @id\n}\n`);
    p.write('prisma/tenancy/orgs/a.prisma', ORG_V1);
    p.write('prisma/tenancy/orgs/b.prisma', ORG_V1);
    let r = p.push(env);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /▶ org_a[\s\S]*▶ org_b/);
    assert.ok((await columns('org_b', 'Org')).includes('note'));

    p.write('prisma/tenancy/orgs/a.prisma', ORG_V2); // additive
    p.write('prisma/tenancy/orgs/b.prisma', ORG_V1.replace('  note  String?\n', '')); // destructive
    r = p.push(env);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /DROP_COLUMN Org\.note {3}@org_b/);
    assert.ok(!(await columns('org_a', 'Org')).includes('extra'), 'org_a must not be pushed when org_b is blocked');

    p.write('prisma/allow-destructive.txt', 'DROP_COLUMN Org.note @org_b\n');
    r = p.push(env);
    assert.equal(r.code, 0, r.out);
    assert.ok((await columns('org_a', 'Org')).includes('extra'));
    assert.ok(!(await columns('org_b', 'Org')).includes('note'));
  } finally {
    p.cleanup();
    await sql(BASE, 'drop schema if exists platform cascade; drop schema if exists org_a cascade; drop schema if exists org_b cascade');
  }
});
