/**
 * Sync a local .env file to a Render service's environment — adh-style
 * (diff → upsert → summary). Merge semantics: every key in the file is
 * added/updated on Render; keys that exist ONLY on Render (dashboard-added,
 * e.g. WATER_SG_INBOUND_API_KEY) are kept unless --prune is passed.
 *
 * Usage:
 *   npm run render-env:staging          # .env.staging  → aims-staging
 *   npm run render-env:prod             # .env.production → aims (PROD)
 *   ... -- --dry-run                    # show the diff, change nothing
 *   ... -- --prune                      # ALSO delete Render-only keys
 *   ... -- --deploy                     # trigger a deploy after syncing
 *
 * Auth: RENDER_API_KEY env var, or a line `RENDER_API_KEY=...` in
 * api-server-production/.env.render (gitignored).
 * Values are never printed — key names only.
 */
import * as fs from 'fs';
import * as path from 'path';

const SERVICES: Record<string, { serviceId: string; envFile: string; label: string }> = {
  staging: { serviceId: 'srv-d70483haae7s73fjip40', envFile: '.env.staging', label: 'aims-staging' },
  prod: { serviceId: 'srv-d1n6domr433s73bec40g', envFile: '.env.production', label: 'aims (PRODUCTION)' },
};

const API = 'https://api.render.com/v1';

function parseEnvFile(file: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2];
    // Strip surrounding quotes; dotenv treats inner content literally.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out.set(m[1], value);
  }
  return out;
}

function apiKey(root: string): string {
  if (process.env.RENDER_API_KEY) return process.env.RENDER_API_KEY;
  const keyFile = path.join(root, '.env.render');
  if (fs.existsSync(keyFile)) {
    const k = parseEnvFile(keyFile).get('RENDER_API_KEY');
    if (k) return k;
  }
  console.error('✗ No RENDER_API_KEY. Export it or put RENDER_API_KEY=... in api-server-production/.env.render');
  process.exit(1);
}

async function render(key: string, method: string, url: string, body?: unknown) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${url} → HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
  }
  return res.status === 204 ? null : res.json();
}

async function fetchCurrent(key: string, serviceId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let cursor: string | undefined;
  for (;;) {
    const page: Array<{ envVar: { key: string; value: string }; cursor: string }> = await render(
      key,
      'GET',
      `/services/${serviceId}/env-vars?limit=100${cursor ? `&cursor=${cursor}` : ''}`,
    );
    if (!page.length) break;
    for (const row of page) out.set(row.envVar.key, row.envVar.value);
    cursor = page[page.length - 1].cursor;
    if (page.length < 100) break;
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const prune = args.includes('--prune');
  const deploy = args.includes('--deploy');
  const svc = target ? SERVICES[target] : undefined;
  if (!svc) {
    console.error(`Usage: update-render-env.ts <${Object.keys(SERVICES).join('|')}> [--dry-run] [--prune] [--deploy]`);
    process.exit(1);
  }
  const root = path.resolve(__dirname, '..');
  const envPath = path.join(root, svc.envFile);
  if (!fs.existsSync(envPath)) {
    console.error(`✗ ${svc.envFile} not found at ${envPath}`);
    process.exit(1);
  }
  const key = apiKey(root);
  const desired = parseEnvFile(envPath);
  const current = await fetchCurrent(key, svc.serviceId);

  const added = Array.from(desired.keys()).filter((k) => !current.has(k));
  const updated = Array.from(desired.keys()).filter((k) => current.has(k) && current.get(k) !== desired.get(k));
  const unchanged = Array.from(desired.keys()).filter((k) => current.has(k) && current.get(k) === desired.get(k));
  const renderOnly = Array.from(current.keys()).filter((k) => !desired.has(k));
  const removed = prune ? renderOnly : [];

  console.log(`\n${dryRun ? '[dry-run] ' : ''}${svc.envFile} → ${svc.label} (${svc.serviceId})`);
  for (const k of added) console.log(`   + ${k}`);
  for (const k of updated) console.log(`   ~ ${k}`);
  for (const k of removed) console.log(`   - ${k}`);
  if (!prune && renderOnly.length) console.log(`   (kept ${renderOnly.length} Render-only: ${renderOnly.join(', ')})`);

  if (dryRun) {
    console.log(`\n[dry-run] Would add: ${added.length}, update: ${updated.length}, remove: ${removed.length}, unchanged: ${unchanged.length}`);
    return;
  }
  for (const k of [...added, ...updated]) {
    await render(key, 'PUT', `/services/${svc.serviceId}/env-vars/${encodeURIComponent(k)}`, { value: desired.get(k) });
  }
  for (const k of removed) {
    await render(key, 'DELETE', `/services/${svc.serviceId}/env-vars/${encodeURIComponent(k)}`);
  }
  console.log(`\n✅ Updated ${svc.label}. Added: ${added.length}, Updated: ${updated.length}, Removed: ${removed.length}, Unchanged: ${unchanged.length}`);

  if (added.length + updated.length + removed.length === 0) {
    console.log('   Nothing changed — no deploy needed.');
    return;
  }
  // Env-var changes via API only take effect on the next deploy.
  if (deploy) {
    await render(key, 'POST', `/services/${svc.serviceId}/deploys`, {});
    console.log('🚀 Deploy triggered.');
  } else {
    console.log('   NOTE: changes apply on the next deploy (pass --deploy to trigger one now).');
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
