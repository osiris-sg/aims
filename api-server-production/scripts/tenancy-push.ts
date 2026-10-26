/**
 * tenancy-push: push the per-org tenancy schemas (TENANCY_MODE=per-org, dev).
 *
 * Restored 2026-10-26 — every tenancy .prisma header references this script,
 * but it was never committed (it lived only on the original dev machine).
 *
 * What it does, per schema file:
 *   DATABASE_URL = <.env DATABASE_URL, "-pooler" stripped> + "?schema=<target>"
 *   npx prisma db push --schema prisma/tenancy/<file> --skip-generate
 *
 * - The DIRECT host is required: pushing a schema through the Neon pooler
 *   fails (WCT_HANDOVER.md §9).
 * - platform.prisma targets the `platform` schema; orgs/<name>.prisma targets
 *   `org_<name>`.
 * - Generation is skipped: `npm run tenancy:generate` owns client generation.
 * - gin_trgm_ops indexes on a NEW schema fail because pg_trgm lives in
 *   `public` — create those by hand (SET search_path TO org_<name>, public),
 *   then re-push. Pushing a COLUMN change to an existing schema is unaffected.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/tenancy-push.ts            # platform + every org
 *   npx ts-node --transpile-only scripts/tenancy-push.ts wct osiris # just these orgs
 *   npx ts-node --transpile-only scripts/tenancy-push.ts --dry      # print the plan only
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const ORGS_DIR = path.join(ROOT, 'prisma', 'tenancy', 'orgs');

function envDatabaseUrl(): string {
  const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  const m = env.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/m);
  if (!m) throw new Error('DATABASE_URL not found in .env');
  return m[1];
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--dry');
  const dry = process.argv.includes('--dry');

  const direct = envDatabaseUrl().replace('-pooler', '');
  const allOrgs = fs
    .readdirSync(ORGS_DIR)
    .filter((f) => f.endsWith('.prisma'))
    .map((f) => f.replace(/\.prisma$/, ''));
  const orgs = args.length ? args : allOrgs;
  for (const o of orgs) {
    if (!allOrgs.includes(o)) throw new Error(`No such org schema: ${o} (have: ${allOrgs.join(', ')})`);
  }

  const targets: Array<{ schemaFile: string; dbSchema: string }> = [
    // platform only on a full run — a scoped run is usually a per-org column.
    ...(args.length ? [] : [{ schemaFile: 'prisma/tenancy/platform.prisma', dbSchema: 'platform' }]),
    ...orgs.map((o) => ({ schemaFile: `prisma/tenancy/orgs/${o}.prisma`, dbSchema: `org_${o}` })),
  ];

  for (const t of targets) {
    const sep = direct.includes('?') ? '&' : '?';
    const url = `${direct}${sep}schema=${t.dbSchema}`;
    console.log(`\n=== db push → ${t.dbSchema} (${t.schemaFile}) ===`);
    if (dry) continue;
    execSync(`npx prisma db push --schema ${t.schemaFile} --skip-generate`, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: url },
    });
  }
  console.log(`\n${dry ? 'Dry run — nothing pushed.' : 'Done.'}`);
}

main();
