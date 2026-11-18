// npm run test:pushguard  — Neon pre-deploy branch logic against a mocked fetch.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshotBeforePush, branchName, API } = require('../lib/neon-branch');

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const quiet = { log: () => {}, warn: () => {}, sleep: async () => {} };
const NOW = new Date('2026-11-19T03:04:05Z');

/** Fake Neon project: records calls, serves branches, supports create/delete. */
function fakeNeon(branches, { failOn } = {}) {
  const calls = [];
  let seq = 0;
  const fetchImpl = async (url, init) => {
    const path = url.replace(API, '');
    calls.push({ method: init.method, path, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.Authorization });
    if (failOn && failOn(init.method, path)) return failOn(init.method, path);
    if (init.method === 'GET') return json(200, { branches });
    if (init.method === 'POST') {
      const b = { id: `br-new-${++seq}`, name: JSON.parse(init.body).branch.name, created_at: NOW.toISOString(), parent_id: JSON.parse(init.body).branch.parent_id };
      branches.push(b);
      return json(201, { branch: b, operations: [] });
    }
    if (init.method === 'DELETE') {
      const id = path.split('/').pop();
      branches.splice(branches.findIndex((b) => b.id === id), 1);
      return json(200, { branch: { id } });
    }
    return json(404, {});
  };
  return { fetchImpl, calls, branches };
}

const pre = (i) => ({ id: `br-old-${i}`, name: `predeploy-abc${i}-2026110${i}000000`, created_at: `2026-11-0${i}T00:00:00Z` });

test('branch name uses the Render commit and a UTC timestamp', () => {
  assert.equal(branchName({ RENDER_GIT_COMMIT: 'a788214d0123' }, NOW), 'predeploy-a788214-20261119030405');
  assert.equal(branchName({}, NOW), 'predeploy-20261119030405');
});

test('missing NEON_API_KEY: warns and skips (no fetch)', async () => {
  const warns = [];
  let called = false;
  const r = await snapshotBeforePush({ env: {}, fetchImpl: async () => { called = true; }, warn: (m) => warns.push(m), log: () => {} });
  assert.deepEqual(r, { skipped: true });
  assert.equal(called, false);
  assert.match(warns[0], /NEON_API_KEY not set/);
});

test('key without project id fails', async () => {
  await assert.rejects(snapshotBeforePush({ env: { NEON_API_KEY: 'k' }, ...quiet }), /NEON_PROJECT_ID/);
});

test('creates from the default branch (no endpoint) and prunes to the newest 5', async () => {
  const neon = fakeNeon([
    { id: 'br-main', name: 'main', default: true, created_at: '2025-01-01T00:00:00Z' },
    { id: 'br-dev', name: 'dev', created_at: '2025-02-01T00:00:00Z' },
    pre(1), pre(2), pre(3), pre(4), pre(5), pre(6),
  ]);
  const r = await snapshotBeforePush({ env: { NEON_API_KEY: 'secret-key', NEON_PROJECT_ID: 'proj-1', RENDER_GIT_COMMIT: 'deadbeefcafe' }, fetchImpl: neon.fetchImpl, now: NOW, ...quiet });
  const post = neon.calls.find((c) => c.method === 'POST');
  assert.equal(post.path, '/projects/proj-1/branches');
  assert.deepEqual(post.body, { branch: { name: 'predeploy-deadbee-20261119030405', parent_id: 'br-main' } });
  assert.equal(post.body.endpoints, undefined);
  assert.equal(post.auth, 'Bearer secret-key');
  assert.equal(r.created.name, 'predeploy-deadbee-20261119030405');
  assert.deepEqual(r.deleted.sort(), [pre(1).name, pre(2).name]);
  const left = neon.branches.map((b) => b.name);
  assert.ok(left.includes('main') && left.includes('dev'), 'non-predeploy branches untouched');
  assert.equal(left.filter((n) => n.startsWith('predeploy-')).length, 5);
});

test('NEON_PARENT_BRANCH_ID skips the lookup', async () => {
  const neon = fakeNeon([]);
  await snapshotBeforePush({ env: { NEON_API_KEY: 'k', NEON_PROJECT_ID: 'p', NEON_PARENT_BRANCH_ID: 'br-x' }, fetchImpl: neon.fetchImpl, now: NOW, ...quiet });
  assert.equal(neon.calls[0].method, 'POST');
  assert.equal(neon.calls[0].body.branch.parent_id, 'br-x');
});

test('API error on create fails (throws), after retrying transient 423s', async () => {
  const neon = fakeNeon([{ id: 'br-main', name: 'main', default: true }], { failOn: (m) => (m === 'POST' ? json(423, { message: 'project already has running operations' }) : null) });
  await assert.rejects(
    snapshotBeforePush({ env: { NEON_API_KEY: 'k', NEON_PROJECT_ID: 'p' }, fetchImpl: neon.fetchImpl, now: NOW, ...quiet }),
    /HTTP 423/,
  );
  assert.equal(neon.calls.filter((c) => c.method === 'POST').length, 5); // 1 + 4 retries
});

test('401 fails immediately; network error fails', async () => {
  const neon = fakeNeon([], { failOn: () => json(401, { message: 'bad key' }) });
  await assert.rejects(snapshotBeforePush({ env: { NEON_API_KEY: 'k', NEON_PROJECT_ID: 'p' }, fetchImpl: neon.fetchImpl, ...quiet }), /HTTP 401/);
  assert.equal(neon.calls.length, 1);
  await assert.rejects(
    snapshotBeforePush({ env: { NEON_API_KEY: 'k', NEON_PROJECT_ID: 'p', NEON_PARENT_BRANCH_ID: 'b' }, fetchImpl: async () => { throw new Error('ECONNRESET'); }, ...quiet }),
    /network error/,
  );
});

test('prune failure only warns (snapshot already exists)', async () => {
  const warns = [];
  const neon = fakeNeon([{ id: 'br-main', name: 'main', default: true }, pre(1), pre(2), pre(3), pre(4), pre(5)], { failOn: (m) => (m === 'DELETE' ? json(400, { message: 'has children' }) : null) });
  const r = await snapshotBeforePush({ env: { NEON_API_KEY: 'k', NEON_PROJECT_ID: 'p' }, fetchImpl: neon.fetchImpl, now: NOW, ...quiet, warn: (m) => warns.push(m) });
  assert.ok(r.created.id);
  assert.equal(r.pruneErrors.length, 1);
  assert.match(warns[0], /prune failed/);
});
