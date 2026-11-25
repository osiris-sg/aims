#!/usr/bin/env node
/* Build-time schema push (called by `npm run build` after `nest build`), now guarded.
 *
 *   TENANCY_MODE unset      → `prisma db push` of prisma/schema.prisma, exactly as before.
 *   TENANCY_MODE=per-org    → generate + push prisma/tenancy/platform.prisma into schema "platform",
 *                             then every prisma/tenancy/orgs/<org>.prisma into its own schema org_<org>.
 *
 * Guards (2026-11, after Prisma db push was seen to silently drop EMPTY tables/columns and
 * every index not declared in schema.prisma):
 *   1. Pre-push check, per target schema, BEFORE anything is pushed:
 *        prisma migrate diff --from-url <db> --to-schema-datamodel <file> --script
 *      The SQL is printed ("Schema changes this deploy will apply"), then classified by
 *      scripts/lib/destructive-sql.js. Any destructive statement (drop table/column/index/type,
 *      type change, SET NOT NULL, required column without default, unique/pk constraint drop,
 *      anything unrecognised) fails the build unless prisma/allow-destructive.txt names it.
 *      The diff command failing or its output being unparseable also fails the build.
 *      All targets are checked first; if any one is blocked, NO schema is pushed.
 *   2. If any target has changes: a Neon branch snapshot (scripts/lib/neon-branch.js) is taken
 *      before the first push. NEON_API_KEY unset → warning; set but failing → build fails.
 *   Passes --accept-data-loss only for a target whose destructive statements are ALL allowlisted (none blocked);
 *   otherwise only the hand-run guard can (see db-push-manual.js).
 *
 * Exports main() for scripts/db-push-manual.js (db:push:prod / :staging) and the tests.
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { classify, parseAllowlist, applyAllowlist, scrub } = require('./lib/destructive-sql');
const { snapshotBeforePush } = require('./lib/neon-branch');

const ROOT = path.join(__dirname, '..');
const PRISMA_DIR = path.join(ROOT, 'prisma');
const ALLOWLIST_FILE = path.join(PRISMA_DIR, 'allow-destructive.txt');
const rel = (p) => path.relative(ROOT, p);

/** Values that must never reach the log: the URL, its password and host. */
function secretsOf(url) {
  const out = [url];
  try {
    const u = new URL(url);
    if (u.password) out.push(decodeURIComponent(u.password), u.password);
    if (u.hostname) out.push(u.hostname);
  } catch { /* unparseable URL: scrub() still masks postgres:// strings */ }
  return out.filter(Boolean);
}

function prisma(args, env, { capture = false } = {}) {
  return spawnSync('npx', ['prisma', ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['inherit', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** Run prisma, echoing its output with secrets masked. Returns true on success. */
function runScrubbed(args, env, secrets, io) {
  const r = prisma(args, env);
  if (r.stdout) io.log(scrub(r.stdout, secrets).trimEnd());
  if (r.stderr) io.error(scrub(r.stderr, secrets).trimEnd());
  if (r.error) io.error(`✖ could not run prisma: ${scrub(r.error.message, secrets)}`);
  return r.status === 0;
}

/** The schemas this push touches, each with its own DATABASE_URL. */
function planTargets(env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  if (env.TENANCY_MODE !== 'per-org') {
    return [{ label: 'default schema', schema: null, file: path.join(PRISMA_DIR, 'schema.prisma'), url: env.DATABASE_URL, perOrg: false }];
  }
  const withSchema = (schema) => {
    const u = new URL(env.DATABASE_URL);
    u.searchParams.set('schema', schema);
    return u.toString();
  };
  const root = path.join(PRISMA_DIR, 'tenancy');
  const orgFiles = fs.readdirSync(path.join(root, 'orgs')).filter((f) => f.endsWith('.prisma')).sort();
  return [
    { label: 'platform', schema: 'platform', file: path.join(root, 'platform.prisma'), url: withSchema('platform'), perOrg: true },
    ...orgFiles.map((f) => {
      const schema = `org_${f.replace(/\.prisma$/, '')}`;
      return { label: schema, schema, file: path.join(root, 'orgs', f), url: withSchema(schema), perOrg: true };
    }),
  ];
}

function loadAllowlist(file = ALLOWLIST_FILE) {
  if (!fs.existsSync(file)) return { entries: [], errors: [] };
  return parseAllowlist(fs.readFileSync(file, 'utf8'));
}

/** Diff + classify one target. Never throws; returns { ok:false, error } on any failure. */
function checkTarget(t, env, entries) {
  const secrets = secretsOf(t.url);
  const r = prisma(['migrate', 'diff', '--from-url', t.url, '--to-schema-datamodel', t.file, '--script'], { ...env, DATABASE_URL: t.url }, { capture: true });
  if (r.error || r.status !== 0) {
    const why = r.error ? r.error.message : `exit ${r.status}\n${r.stderr || ''}${r.stdout || ''}`;
    return { target: t, ok: false, error: `prisma migrate diff failed: ${scrub(why, secrets).trim()}` };
  }
  const sql = scrub(r.stdout || '', secrets);
  if (!sql.trim()) return { target: t, ok: false, error: 'prisma migrate diff printed nothing (expected SQL or "-- This is an empty migration.")' };
  let c;
  try {
    c = classify(sql);
  } catch (e) {
    return { target: t, ok: false, error: `could not parse the diff SQL: ${e.message}` };
  }
  if (c.empty && !/This is an empty migration/i.test(sql)) {
    return { target: t, ok: false, error: 'diff output had no statements and no "empty migration" marker' };
  }
  const { allowed, blocked, used } = applyAllowlist(c.destructive, entries, t.schema);
  return { target: t, ok: true, sql, empty: c.empty, allowed, blocked, used, warnings: c.warnings };
}

function report(res, io) {
  const head = `── ${res.target.label} (${rel(res.target.file)})`;
  if (!res.ok) { io.error(`${head}\n✖ ${res.error}`); return; }
  if (res.empty) { io.log(`${head}: no schema changes.`); return; }
  io.log(`${head}\nSchema changes this deploy will apply:\n${res.sql.trim()}\n`);
  for (const w of res.warnings) io.log(`⚠ ${w}`);
  for (const a of res.allowed) io.log(`✔ allowed by prisma/allow-destructive.txt line ${a.entry.line}: ${a.key}`);
  if (res.blocked.length) {
    io.error('✖ DESTRUCTIVE schema change(s) — refusing to push:');
    for (const b of res.blocked) io.error(`    ${b.key}${res.target.schema ? `   @${res.target.schema}` : ''}\n      ↳ ${b.sql}`);
  }
}

/**
 * opts:
 *   env            process env (DATABASE_URL, TENANCY_MODE, NEON_*)
 *   confirm        async (summary) => boolean — hand pushes only; called after the checks pass
 *   acceptDataLoss pass --accept-data-loss (hand pushes only; blocked items then still need confirm)
 *   fetchImpl      for the Neon API (tests)
 * Returns the process exit code.
 */
async function main(opts = {}) {
  const env = opts.env || process.env;
  const io = opts.io || { log: console.log, error: console.error, warn: console.warn };
  let targets;
  try {
    targets = planTargets(env);
  } catch (e) {
    io.error(`✖ db-push: ${scrub(e.message, secretsOf(env.DATABASE_URL || ''))}`);
    return 1;
  }
  const allSecrets = secretsOf(env.DATABASE_URL);

  // Client generation first, exactly as before (per-org mode generates every client up front).
  if (targets[0].perOrg) {
    const gens = [[], ...targets.map((t) => ['--schema', t.file])];
    for (const g of gens) if (!runScrubbed(['generate', ...g], env, allSecrets, io)) return 1;
  }

  const { entries, errors } = loadAllowlist(opts.allowlistFile);
  if (errors.length) {
    io.error(`✖ prisma/allow-destructive.txt is malformed:\n  ${errors.join('\n  ')}`);
    return 1;
  }

  io.log('\n═══ Schema push pre-check (prisma migrate diff) ═══');
  const results = targets.map((t) => {
    const r = checkTarget(t, env, entries);
    report(r, io);
    return r;
  });

  const failed = results.filter((r) => !r.ok);
  const blocked = results.filter((r) => r.ok && r.blocked.length);
  const changed = results.filter((r) => r.ok && !r.empty);
  const used = new Set(results.flatMap((r) => (r.ok ? [...r.used] : [])));
  const unused = entries.filter((e) => !used.has(e));
  if (unused.length) io.log(`ℹ allowlist entries not used by this push (remove them once deployed): ${unused.map((e) => `line ${e.line} "${e.key}"`).join(', ')}`);

  if (failed.length) {
    io.error('\n✖ Schema pre-check could not run — NOT pushing (fail safe).');
    return 1;
  }
  if (blocked.length && !opts.acceptDataLoss) {
    io.error([
      '',
      '✖ Build stopped: this deploy would DROP or rewrite existing schema objects (see above). Nothing was pushed.',
      '  If the change is intended, add the exact key line(s) shown above to prisma/allow-destructive.txt',
      '  (one per line; see the header of that file), commit, and deploy again.',
    ].join('\n'));
    return 1;
  }
  if (!changed.length) {
    io.log('No schema changes in any target.');
    if (opts.confirm) { io.log('Nothing to push.'); return 0; }
  }

  if (opts.confirm && !(await opts.confirm({ results, blocked, changed }))) {
    io.error('✖ Not confirmed — nothing pushed.');
    return 1;
  }

  if (changed.length) {
    try {
      await snapshotBeforePush({ env, fetchImpl: opts.fetchImpl, log: io.log, warn: io.warn || io.log });
    } catch (e) {
      io.error(`✖ Neon pre-deploy branch failed — NOT pushing: ${scrub(e.message, [...allSecrets, env.NEON_API_KEY])}`);
      return 1;
    }
  }

  for (const [i, t] of targets.entries()) {
    // A target whose every destructive statement is named in prisma/allow-destructive.txt (none blocked) is pushed
    // with --accept-data-loss: the allowlist IS the approval. Without it Prisma refuses even an allowed change
    // (round BZ, 25 Nov 2026: Decimal(14,3) → (14,4) failed the Render build "Use the --accept-data-loss flag").
    const r = results[i];
    const allowlisted = !!(r && r.ok && r.allowed.length && !r.blocked.length);
    if (allowlisted && !opts.acceptDataLoss) io.log(`ℹ ${t.label}: every destructive statement is allowlisted — pushing with --accept-data-loss`);
    const extra = opts.acceptDataLoss || allowlisted ? ['--accept-data-loss'] : [];
    const args = ['db', 'push', '--schema', t.file, ...extra];
    if (t.perOrg) { args.splice(2, 0, '--skip-generate'); io.log(`\n▶ ${t.label}`); }
    if (!runScrubbed(args, { ...env, DATABASE_URL: t.url }, secretsOf(t.url), io)) return 1;
  }
  return 0;
}

module.exports = { main, planTargets, checkTarget, loadAllowlist, secretsOf };

if (require.main === module) {
  main().then((code) => process.exit(code), (e) => {
    console.error(`✖ db-push crashed: ${scrub(e && e.stack, secretsOf(process.env.DATABASE_URL || ''))}`);
    process.exit(1);
  });
}
