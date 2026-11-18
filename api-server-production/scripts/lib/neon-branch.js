/* Safeguard 2 for schema pushes: snapshot the database as a Neon branch right before a
 * non-empty push, so any push (even an allowlisted or "harmless" one) can be undone by
 * restoring from / pointing at the branch. Uses the Neon HTTP API v2 with Node's built-in fetch.
 *
 * Env:
 *   NEON_API_KEY            required to enable; unset → warning, push continues without a snapshot.
 *   NEON_PROJECT_ID         required when NEON_API_KEY is set.
 *   NEON_PARENT_BRANCH_ID   optional; default = the project's default (primary) branch, looked up.
 *   RENDER_GIT_COMMIT       optional; short sha goes into the branch name.
 *
 * Policy (documented choice):
 *   - Key set but snapshot cannot be created → THROW (the build fails, nothing is pushed). A safety
 *     net that was explicitly configured and silently doesn't work is worse than a failed deploy.
 *   - Pruning old predeploy-* branches failing → warning only (the new snapshot exists; cleanup can wait).
 *   - Branches are created WITHOUT a compute endpoint (no `endpoints` in the request): storage-only,
 *     no compute cost. Attach a compute in the Neon console when you need to read/restore from one.
 *   - Keep the newest KEEP (5) predeploy-* branches, delete the rest (oldest first).
 *
 * Unit tested with a mocked fetch in scripts/__tests__/neon-branch.test.js.
 */
'use strict';

const API = 'https://console.neon.tech/api/v2';
const PREFIX = 'predeploy-';
const KEEP = 5;

const stamp = (d) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHmmss (UTC)

function branchName(env, now = new Date()) {
  const sha = (env.RENDER_GIT_COMMIT || '').slice(0, 7).replace(/[^0-9a-zA-Z]/g, '');
  return `${PREFIX}${sha ? `${sha}-` : ''}${stamp(now)}`;
}

function makeClient({ apiKey, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), retries = 4 }) {
  return async function call(method, path, body) {
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let res;
      try {
        res = await fetchImpl(`${API}${path}`, {
          method,
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        last = new Error(`Neon API ${method} ${path}: network error: ${e.message}`);
        if (attempt < retries) { await sleep(1000 * (attempt + 1)); continue; }
        throw last;
      }
      if (res.ok) return res.status === 204 ? {} : res.json();
      let text = '';
      try { text = (await res.text()).slice(0, 300); } catch { /* ignore */ }
      last = new Error(`Neon API ${method} ${path}: HTTP ${res.status} ${text}`.trim());
      // 423 = project has a running operation (Neon serialises them); 429/5xx = transient.
      if ((res.status === 423 || res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw last;
    }
    throw last;
  };
}

/**
 * Create the predeploy branch and prune old ones. Returns
 *   { skipped: true } when NEON_API_KEY is unset (after logging a warning), else
 *   { created: {id,name}, deleted: [names], pruneErrors: [msg] }.
 * Throws when the key is set but the snapshot could not be created.
 */
async function snapshotBeforePush({ env = process.env, fetchImpl = globalThis.fetch, log = console.log, warn = console.warn, now = new Date(), sleep, keep = KEEP } = {}) {
  const apiKey = env.NEON_API_KEY;
  if (!apiKey) {
    warn('⚠ NEON_API_KEY not set: no Neon pre-deploy branch will be created for this push (set NEON_API_KEY + NEON_PROJECT_ID to enable).');
    return { skipped: true };
  }
  const projectId = env.NEON_PROJECT_ID;
  if (!projectId) throw new Error('NEON_API_KEY is set but NEON_PROJECT_ID is not — cannot create the pre-deploy branch.');
  const call = makeClient({ apiKey, fetchImpl, ...(sleep ? { sleep } : {}) });
  const base = `/projects/${encodeURIComponent(projectId)}/branches`;

  let parentId = env.NEON_PARENT_BRANCH_ID;
  let listed;
  if (!parentId) {
    listed = (await call('GET', base)).branches || [];
    const parent = listed.find((b) => b.default) || listed.find((b) => b.primary);
    if (!parent) throw new Error('Neon: could not find the default branch; set NEON_PARENT_BRANCH_ID.');
    parentId = parent.id;
  }

  const name = branchName(env, now);
  const res = await call('POST', base, { branch: { name, parent_id: parentId } });
  const created = res && res.branch;
  if (!created || !created.id) throw new Error('Neon: branch create returned no branch id.');
  log(`✔ Neon pre-deploy branch created: ${created.name || name} (${created.id}) from ${parentId}`);

  // Prune: keep the newest `keep` predeploy-* branches (the new one included).
  const deleted = [];
  const pruneErrors = [];
  try {
    const all = (await call('GET', base)).branches || [];
    const mine = all
      .filter((b) => typeof b.name === 'string' && b.name.startsWith(PREFIX))
      .filter((b) => !b.default && !b.primary && !b.protected);
    if (!mine.some((b) => b.id === created.id)) mine.push({ ...created, name: created.name || name, created_at: created.created_at || now.toISOString() });
    mine.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    for (const b of mine.slice(keep)) {
      if (b.id === created.id) continue;
      try {
        await call('DELETE', `${base}/${encodeURIComponent(b.id)}`);
        deleted.push(b.name);
      } catch (e) {
        pruneErrors.push(`${b.name}: ${e.message}`);
      }
    }
  } catch (e) {
    pruneErrors.push(e.message);
  }
  if (deleted.length) log(`  pruned old pre-deploy branches: ${deleted.join(', ')}`);
  for (const e of pruneErrors) warn(`⚠ Neon prune failed (snapshot still created): ${e}`);
  return { created: { id: created.id, name: created.name || name }, deleted, pruneErrors };
}

module.exports = { snapshotBeforePush, branchName, PREFIX, KEEP, API };
